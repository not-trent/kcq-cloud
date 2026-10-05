import { useEffect, useMemo, useState } from 'react';
import {
  fetchModulesWithEntries,
  createModule as createModuleRecord,
  renameModule as renameModuleRecord,
  deleteModule as deleteModuleRecord,
  findDuplicateQuestion,
  uploadQuestionEntry,
  deleteQuestionEntry,
} from './lib/localData';
import { extractQuestionDataFromImage } from './lib/ocr';
import { compressToWebp } from './lib/compressImage';
import { inferQuestionAnswerFromText, deriveQuestionFromFile } from './lib/textParsing';
import { subscribeToDataChanges } from './lib/realtime';

const galleryTabs = [
  { id: 'all', label: 'All' },
  { id: 'correct', label: 'Correct' },
  { id: 'incorrect', label: 'Incorrect' },
];

function App() {
  const [modules, setModules] = useState([]);
  const [selectedModuleId, setSelectedModuleId] = useState('');
  const [moduleName, setModuleName] = useState('');
  const [search, setSearch] = useState('');
  const [selectedImages, setSelectedImages] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [importingFolder, setImportingFolder] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [galleryOpen, setGalleryOpen] = useState(false);
  const [galleryIndex, setGalleryIndex] = useState(0);
  const [zoomLevel, setZoomLevel] = useState(1);
  const [isDragging, setIsDragging] = useState(false);
  const [userName, setUserName] = useState(() => {
    if (typeof window === 'undefined') return '';
    return window.localStorage.getItem('kcq-user-name') || '';
  });
  const [loginOpen, setLoginOpen] = useState(() => {
    if (typeof window === 'undefined') return true;
    return !window.localStorage.getItem('kcq-user-name');
  });
  const [duplicateQueue, setDuplicateQueue] = useState([]);
  const [duplicateReview, setDuplicateReview] = useState(null);
  const [moduleMenuOpen, setModuleMenuOpen] = useState(null);
  const [galleryTab, setGalleryTab] = useState('all');
  const [showCreateModule, setShowCreateModule] = useState(false);
  const realtimeEnabled =
    import.meta.env.VITE_SUPABASE_URL &&
    import.meta.env.VITE_SUPABASE_ANON_KEY &&
    import.meta.env.VITE_ENABLE_SUPABASE_REALTIME === 'true';

  const selectedModule = useMemo(
    () => modules.find((module) => module.id === selectedModuleId) || null,
    [modules, selectedModuleId]
  );

  const filteredEntries = useMemo(() => {
    if (!selectedModule?.entries) return [];

    if (galleryTab === 'correct') {
      return selectedModule.entries.filter((entry) => String(entry.status || '').toLowerCase() === 'correct');
    }

    if (galleryTab === 'incorrect') {
      return selectedModule.entries.filter((entry) => String(entry.status || '').toLowerCase() === 'incorrect');
    }

    return selectedModule.entries;
  }, [galleryTab, selectedModule]);

  const galleryItems = useMemo(
    () => filteredEntries.map((entry) => ({
      src: entry.screenshot,
      alt: entry.question || 'Shared screenshot',
      caption: entry.question || 'Uploaded image',
      uploader: entry.uploadedBy || 'Anonymous',
      uploadedAt: entry.createdAt,
      status: entry.status || 'unreviewed',
      id: entry.id,
    })),
    [filteredEntries]
  );

  const moduleStats = useMemo(() => {
    const totalEntries = modules.reduce((sum, module) => sum + (module.entries?.length || 0), 0);
    const selectedEntries = selectedModule?.entries || [];
    const correct = selectedEntries.filter((entry) => String(entry.status || '').toLowerCase() === 'correct').length;
    const incorrect = selectedEntries.filter((entry) => String(entry.status || '').toLowerCase() === 'incorrect').length;

    return {
      modules: modules.length,
      images: totalEntries,
      selected: selectedEntries.length,
      correct,
      incorrect,
    };
  }, [modules, selectedModule]);

  const hashFile = async (file) => {
    const buffer = await file.arrayBuffer();
    const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
    return Array.from(new Uint8Array(hashBuffer)).map((value) => value.toString(16).padStart(2, '0')).join('');
  };

  const loadModules = async () => {
    const data = await fetchModulesWithEntries();
    setModules(data);

    if (data.length === 0) {
      setSelectedModuleId('');
      return;
    }

    if (!selectedModuleId || !data.some((module) => module.id === selectedModuleId)) {
      setSelectedModuleId(data[0].id);
    }
  };

  const handleLoginSubmit = (event) => {
    event.preventDefault();
    if (!userName.trim()) return;
    window.localStorage.setItem('kcq-user-name', userName);
    setLoginOpen(false);
  };

  const renameModule = async (moduleId) => {
    const module = modules.find((item) => item.id === moduleId);
    if (!module) return;

    const nextName = window.prompt('Rename module', module.name);
    if (!nextName || !nextName.trim()) return;

    try {
      const updated = await renameModuleRecord(moduleId, nextName);
      setError('');
      setMessage(`Module renamed to "${updated.name}".`);
      await loadModules();
      setSelectedModuleId(updated.id);
    } catch (err) {
      setError(err.message || 'Failed to rename module.');
    }
  };

  const createModule = async (event) => {
    event.preventDefault();
    if (!moduleName.trim()) return;

    try {
      const created = await createModuleRecord(moduleName.trim());
      setModuleName('');
      setError('');
      setSelectedModuleId(created.id);
      setShowCreateModule(false);
      setMessage(`Module "${created.name}" created.`);
      await loadModules();
    } catch (err) {
      setError(err.message || 'Failed to create module.');
    }
  };

  const handleFileSelect = (event) => {
    const files = Array.from(event.target.files || []);
    setSelectedImages((current) => [...current, ...files]);
    event.target.value = '';
  };

  const importFolder = async (event) => {
    const files = Array.from(event.target.files || [])
      .filter((file) => file.type.startsWith('image/'))
      .sort((left, right) => (left.webkitRelativePath || left.name).localeCompare(right.webkitRelativePath || right.name, undefined, { numeric: true }));
    event.target.value = '';

    if (!files.length) {
      setError('The selected folder does not contain any images.');
      return;
    }

    const groupedFiles = new Map();
    files.forEach((file) => {
      const pathParts = (file.webkitRelativePath || file.name).split('/');
      const moduleName = pathParts.length > 2 ? pathParts[1] : pathParts[0];
      if (!groupedFiles.has(moduleName)) groupedFiles.set(moduleName, []);
      groupedFiles.get(moduleName).push(file);
    });

    setImportingFolder(true);
    setUploading(true);
    setError('');
    setMessage(`Importing ${groupedFiles.size} module(s)...`);

    try {
      const knownModules = [...modules];
      let importedCount = 0;
      let skippedCount = 0;
      let firstImportedModuleId = '';

      for (const [name, moduleFiles] of groupedFiles) {
        let targetModule = knownModules.find((module) => module.name.toLowerCase() === name.toLowerCase());

        if (!targetModule) {
          targetModule = await createModuleRecord(name);
          knownModules.push({ ...targetModule, entries: [] });
        }

        if (!firstImportedModuleId) firstImportedModuleId = targetModule.id;

        for (const file of moduleFiles) {
          const imageHash = await hashFile(file);
          const duplicate = await findDuplicateQuestion(targetModule.id, imageHash);
          if (duplicate) {
            skippedCount += 1;
            continue;
          }

          const { text: ocrText, selectedOption } = await extractQuestionDataFromImage(file);
          const inferred = inferQuestionAnswerFromText(ocrText, selectedOption);
          const webpBlob = await compressToWebp(file);

          await uploadQuestionEntry({
            moduleId: targetModule.id,
            slug: targetModule.slug,
            file: webpBlob,
            question: inferred.question || deriveQuestionFromFile(file.name),
            answer: inferred.answer || '',
            options: inferred.options || [],
            ocrText,
            imageHash,
            uploadedBy: userName || 'Anonymous',
          });

          importedCount += 1;
        }
      }

      if (firstImportedModuleId) setSelectedModuleId(firstImportedModuleId);
      await loadModules();
      setMessage(`Imported ${importedCount} image(s) across ${groupedFiles.size} module(s).${skippedCount ? ` Skipped ${skippedCount} duplicate(s).` : ''}`);
    } catch (err) {
      setError(err.message || 'Folder import failed.');
    } finally {
      setImportingFolder(false);
      setUploading(false);
    }
  };

  const handleDropFiles = (event) => {
    event.preventDefault();
    event.stopPropagation();
    setIsDragging(false);

    const files = Array.from(event.dataTransfer?.files || []).filter((file) => file.type.startsWith('image/'));
    setSelectedImages((current) => [...current, ...files]);
  };

  const uploadSelectedImages = async (filesToUpload = selectedImages) => {
    if (!selectedModuleId || !filesToUpload.length) {
      setError('Select a module and choose at least one image first.');
      return;
    }

    const currentModule = modules.find((module) => module.id === selectedModuleId);
    if (!currentModule) {
      setError('Select a module first.');
      return;
    }

    setUploading(true);
    setError('');
    setMessage('');

    try {
      let savedCount = 0;
      for (let index = 0; index < filesToUpload.length; index += 1) {
        const file = filesToUpload[index];
        const imageHash = await hashFile(file);
        const duplicate = await findDuplicateQuestion(selectedModuleId, imageHash);

        if (duplicate) {
          setDuplicateReview({ file, existingEntry: duplicate });
          setDuplicateQueue(filesToUpload.slice(index + 1).map((nextFile) => ({ file: nextFile, existingEntry: duplicate })));
          setUploading(false);
          return;
        }

        const { text: ocrText, selectedOption } = await extractQuestionDataFromImage(file);
        const inferred = inferQuestionAnswerFromText(ocrText, selectedOption);
        const webpBlob = await compressToWebp(file);

        await uploadQuestionEntry({
          moduleId: selectedModuleId,
          slug: currentModule.slug,
          file: webpBlob,
          question: inferred.question || deriveQuestionFromFile(file.name),
          answer: inferred.answer || '',
          options: inferred.options || [],
          ocrText,
          imageHash,
          uploadedBy: userName || 'Anonymous',
        });

        savedCount += 1;
      }

      setSelectedImages([]);
      setDuplicateQueue([]);
      setDuplicateReview(null);
      setMessage(`${savedCount} image(s) saved to the module.`);
      await loadModules();
    } catch (err) {
      setError(err.message || 'Upload failed.');
    } finally {
      setUploading(false);
    }
  };

  const resolveDuplicateReview = async (decision) => {
    if (!duplicateReview) return;

    const remainingFiles = [...selectedImages].filter((file) => file !== duplicateReview.file);
    const keepNewFiles = decision === 'keep-new' ? [...selectedImages] : remainingFiles;

    const nextQueue = duplicateQueue.slice(1);

    if (nextQueue.length) {
      const nextReview = nextQueue[0];
      setDuplicateQueue(nextQueue);
      setDuplicateReview(nextReview);
      return;
    }

    setDuplicateQueue([]);
    setDuplicateReview(null);

    if (decision === 'keep-new') {
      await uploadSelectedImages(keepNewFiles);
      return;
    }

    setSelectedImages(keepNewFiles);
    if (!keepNewFiles.length) {
      setMessage('Duplicate image discarded.');
      return;
    }
    await uploadSelectedImages(keepNewFiles);
  };

  const removeEntry = async (entryId) => {
    if (!selectedModuleId) return;

    try {
      await deleteQuestionEntry(selectedModuleId, entryId);
      await loadModules();
    } catch (err) {
      setError(err.message || 'Failed to remove entry.');
    }
  };

  const removeModule = async (moduleId) => {
    if (!window.confirm('Are you sure you want to remove this module? This cannot be undone.')) return;

    try {
      await deleteModuleRecord(moduleId);
      if (selectedModuleId === moduleId) {
        setSelectedModuleId('');
      }
      setModuleMenuOpen(null);
      await loadModules();
    } catch (err) {
      setError(err.message || 'Failed to remove module.');
    }
  };

  const openGallery = (index = 0) => {
    setGalleryIndex(index);
    setZoomLevel(1);
    setGalleryOpen(true);
  };

  const handleWheelZoom = (event) => {
    event.preventDefault();
    setZoomLevel((current) => {
      const delta = event.deltaY > 0 ? -0.1 : 0.1;
      return Math.min(3, Math.max(0.6, Number((current + delta).toFixed(2))));
    });
  };

  const statusTone = (status) => {
    const normalized = String(status || '').toLowerCase();
    if (normalized === 'correct') return 'success';
    if (normalized === 'incorrect') return 'danger';
    return 'neutral';
  };

  useEffect(() => {
    if (!galleryOpen) return;

    const handleKeyDown = (event) => {
      if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
        event.preventDefault();
        setGalleryIndex((value) => (value === galleryItems.length - 1 ? 0 : value + 1));
      }

      if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
        event.preventDefault();
        setGalleryIndex((value) => (value === 0 ? galleryItems.length - 1 : value - 1));
      }

      if (event.key === 'Escape') {
        setGalleryOpen(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [galleryOpen, galleryItems.length]);

  useEffect(() => {
    loadModules();
  }, []);

  useEffect(() => {
    if (!realtimeEnabled) return undefined;

    return subscribeToDataChanges(() => {
      loadModules();
    }, 250);
  }, [realtimeEnabled]);

  useEffect(() => {
    if (!message) return undefined;
    const id = window.setTimeout(() => setMessage(''), 3000);
    return () => window.clearTimeout(id);
  }, [message]);

  useEffect(() => {
    if (!error) return undefined;
    const id = window.setTimeout(() => setError(''), 3000);
    return () => window.clearTimeout(id);
  }, [error]);

  return (
    <div className="app-shell">
      {loginOpen && (
        <div className="login-backdrop">
          <div className="login-card">
            <div className="login-header">
              <span className="login-badge">KCQ</span>
              <h2>Welcome back</h2>
            </div>
            <p>Enter your name to continue.</p>
            <form onSubmit={handleLoginSubmit} className="login-form">
              <input
                value={userName}
                onChange={(event) => setUserName(event.target.value)}
                placeholder="Your name"
                autoFocus
              />
              <button type="submit">Enter archive</button>
            </form>
          </div>
        </div>
      )}

      {duplicateReview && (
        <div className="duplicate-backdrop">
          <div className="duplicate-modal">
            <div className="duplicate-header">
              <h3>Duplicate image detected</h3>
              <p>Review the current item and the new upload before saving.</p>
            </div>
            <div className="duplicate-grid">
              <div className="duplicate-panel">
                <img src={duplicateReview.file ? URL.createObjectURL(duplicateReview.file) : ''} alt="incoming upload" />
                <span>New upload</span>
              </div>
              <div className="duplicate-panel">
                <img src={duplicateReview.existingEntry?.screenshot} alt="existing archive image" />
                <span>Current item</span>
              </div>
            </div>
            <div className="duplicate-actions">
              <button type="button" onClick={() => resolveDuplicateReview('keep-existing')}>Keep existing</button>
              <button type="button" className="secondary" onClick={() => resolveDuplicateReview('keep-new')}>Keep new</button>
              <button type="button" className="danger" onClick={() => resolveDuplicateReview('dispose')}>Dispose</button>
            </div>
          </div>
        </div>
      )}

      <aside className="sidebar">
        <div className="brand-box">
          <div className="brand-mark">KCQ</div>
          <div>
            <h1>KCQ Cloud</h1>
            <p>Shared module archive</p>
          </div>
        </div>

        <div className="sidebar-modules">
          <div className="module-toolbar">
            <h3>Modules</h3>
            <button type="button" className="mini-button" onClick={() => setShowCreateModule((value) => !value)}>
              + New module
            </button>
          </div>

          {showCreateModule && (
            <form onSubmit={createModule} className="module-create-form">
              <input
                value={moduleName}
                onChange={(event) => setModuleName(event.target.value)}
                placeholder="Module name"
                autoFocus
              />
              <div className="module-create-actions">
                <button type="submit">Create</button>
                <button type="button" className="secondary" onClick={() => setShowCreateModule(false)}>Cancel</button>
              </div>
            </form>
          )}

          {modules.length === 0 ? (
            <div className="empty-card compact"><span className="empty-icon">◎</span>No modules yet.</div>
          ) : (
            <ul className="module-list">
              {modules.map((module) => (
                <li key={module.id}>
                  <div className="module-row">
                    <button
                      className={module.id === selectedModuleId ? 'module-button active' : 'module-button'}
                      type="button"
                      onClick={() => setSelectedModuleId(module.id)}
                    >
                      <span className="module-name">{module.name}</span>
                      <span className="module-count">{module.entries?.length || 0} images</span>
                    </button>
                    <div className="module-menu-wrapper">
                      <button
                        type="button"
                        className="module-menu-button"
                        onClick={() => setModuleMenuOpen(moduleMenuOpen === module.id ? null : module.id)}
                        aria-label={`Open module actions for ${module.name}`}
                      >
                        ⋯
                      </button>
                      {moduleMenuOpen === module.id && (
                        <div className="module-dropdown-menu">
                          <button
                            type="button"
                            onClick={() => {
                              renameModule(module.id);
                              setModuleMenuOpen(null);
                            }}
                          >
                            Rename
                          </button>
                          <button
                            type="button"
                            className="danger"
                            onClick={() => removeModule(module.id)}
                          >
                            Remove
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </aside>

      <main className="main-panel">
        <header className="topbar">
          <div>
            <p className="eyebrow">Dashboard</p>
            <h2>{selectedModule?.name || 'No module selected'}</h2>
          </div>
          <div className="topbar-tools">
            <span className="user-pill">{userName || 'Anonymous'}</span>
          </div>
        </header>

        <section className="summary-row">
          <div className="summary-chip">
            <span>Modules</span>
            <strong>{moduleStats.modules}</strong>
          </div>
          <div className="summary-chip">
            <span>Images</span>
            <strong>{moduleStats.images}</strong>
          </div>
          <div className="summary-chip">
            <span>In this module</span>
            <strong>{moduleStats.selected}</strong>
          </div>
          <div className="summary-chip success">
            <span>Correct</span>
            <strong>{moduleStats.correct}</strong>
          </div>
          <div className="summary-chip danger">
            <span>Incorrect</span>
            <strong>{moduleStats.incorrect}</strong>
          </div>
        </section>

        <section className="panel upload-panel">
          <div className="panel-header">
            <h3>Upload images</h3>
            <label className="upload-button folder-import-button">
              {importingFolder ? 'Importing...' : 'Import KCQs folder'}
              <input type="file" webkitdirectory="" directory="" multiple accept="image/*" onChange={importFolder} disabled={importingFolder} />
            </label>
          </div>
          <div
            className={isDragging ? 'dropzone active' : 'dropzone'}
            onDragOver={(event) => {
              event.preventDefault();
              setIsDragging(true);
            }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={handleDropFiles}
          >
            <div className="dropzone-copy">
              <span className="upload-icon">⇪</span>
              <div>
                <p>Drop images here</p>
                <small>or browse from your device</small>
              </div>
            </div>
            <label className="upload-button">
              Choose files
              <input type="file" multiple accept="image/*" onChange={handleFileSelect} />
            </label>
          </div>

          {selectedImages.length > 0 && (
            <div className="preview-grid">
              {selectedImages.map((file, index) => (
                <div key={`${file.name}-${file.size}-${index}`} className="preview-card">
                  <img src={URL.createObjectURL(file)} alt={file.name} />
                  <span>{file.name}</span>
                </div>
              ))}
            </div>
          )}

          <div className="upload-actions">
            <button type="button" onClick={() => uploadSelectedImages()} disabled={uploading || !selectedModuleId || !selectedImages.length}>
              {uploading ? 'Saving...' : 'Save images'}
            </button>
          </div>
        </section>

        <div className="gallery-tab-row">
          {galleryTabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              className={galleryTab === tab.id ? 'gallery-tab active' : 'gallery-tab'}
              onClick={() => setGalleryTab(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <section className="entries-grid">
          {galleryItems.length ? (
            galleryItems.map((entry, index) => (
              <article key={`${entry.src}-${index}`} className="entry-card">
                <img
                  src={entry.src}
                  alt={entry.alt}
                  className="entry-image clickable-image"
                  onClick={() => openGallery(index)}
                />
                <div className="entry-meta">
                  <div className="entry-meta-top">
                    <span className={`status-pill ${statusTone(entry.status)}`}>{entry.status || 'unreviewed'}</span>
                  </div>
                  <strong>{entry.caption}</strong>
                  {entry.answer && <span className="entry-answer">Answer: {entry.answer}</span>}
                  <span>Uploaded by {entry.uploader}</span>
                  <small>
                    {entry.uploadedAt
                      ? new Date(entry.uploadedAt).toLocaleDateString(undefined, {
                          year: 'numeric',
                          month: 'short',
                          day: 'numeric',
                        })
                      : 'Recently uploaded'}
                  </small>
                </div>
                <div className="entry-actions">
                  <button type="button" className="danger" onClick={() => removeEntry(entry.id)}>
                    Remove
                  </button>
                </div>
              </article>
            ))
          ) : (
            <div className="empty-card gallery-empty">
              <span className="empty-icon">◌</span>
              <h3>No images here yet</h3>
              <p>Drop a few screenshots into this module to start building the archive.</p>
            </div>
          )}
        </section>
      </main>

      {message && <div className="toast success">{message}</div>}
      {error && <div className="toast error">{error}</div>}

      {galleryOpen && galleryItems.length > 0 && (
        <div className="image-modal-backdrop" onClick={() => setGalleryOpen(false)}>
          <div className="image-modal-panel" onClick={(event) => event.stopPropagation()}>
            <div className="modal-toolbar">
              <div>
                <small>{galleryItems[galleryIndex]?.caption}</small>
              </div>
              <div className="zoom-controls">
                <button type="button" onClick={() => setZoomLevel((value) => Math.max(0.6, Number((value - 0.1).toFixed(2))))}>-</button>
                <button type="button" onClick={() => setZoomLevel((value) => Math.min(3, Number((value + 0.1).toFixed(2))))}>+</button>
                <button type="button" className="secondary" onClick={() => setZoomLevel(1)}>Reset</button>
              </div>
            </div>

            <div className="image-viewport" onWheel={handleWheelZoom}>
              <img
                src={galleryItems[galleryIndex]?.src}
                alt={galleryItems[galleryIndex]?.alt}
                className="zoom-image"
                style={{ transform: `scale(${zoomLevel})` }}
              />
            </div>

            <div className="thumbnail-strip">
              {galleryItems.map((item, index) => (
                <button
                  key={`${item.src}-${index}`}
                  type="button"
                  className={index === galleryIndex ? 'thumb-button active' : 'thumb-button'}
                  onClick={() => setGalleryIndex(index)}
                >
                  <img src={item.src} alt={item.alt} />
                </button>
              ))}
            </div>

            <div className="modal-footer">
              <button type="button" onClick={() => setGalleryIndex((value) => (value === 0 ? galleryItems.length - 1 : value - 1))}>
                Previous
              </button>
              <button type="button" onClick={() => setGalleryOpen(false)} className="secondary">
                Close
              </button>
              <button type="button" onClick={() => setGalleryIndex((value) => (value === galleryItems.length - 1 ? 0 : value + 1))}>
                Next
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
