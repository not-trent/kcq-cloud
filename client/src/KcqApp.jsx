import { useEffect, useMemo, useRef, useState } from 'react';
import JSZip from 'jszip';
import { Archive, ArrowDownToLine, ChevronLeft, ChevronRight, Cloud, Expand, FolderOpen, ImagePlus, Images, LoaderCircle, Plus, Search, Trash2, Upload, X } from 'lucide-react';
import { createModule, deleteQuestionEntry, fetchModulesWithEntries, uploadModulePhoto } from './lib/supabaseData';
import { supabaseConfigError } from './lib/supabaseClient';
import './kcq.css';

const imageExtensions = new Set(['.avif', '.bmp', '.gif', '.heic', '.jpeg', '.jpg', '.png', '.tif', '.tiff', '.webp']);

function isImagePath(path) {
  const extension = path.match(/\.[^.\/]+$/)?.[0].toLowerCase();
  return imageExtensions.has(extension);
}

function groupFolderFiles(files) {
  const groups = new Map();
  for (const file of files) {
    if (!isImagePath(file.name) && !file.type.startsWith('image/')) continue;
    const pathParts = (file.webkitRelativePath || '').split('/').filter(Boolean);
    if (pathParts.length < 3) continue;
    const moduleName = pathParts.slice(1, -1).join(' / ').trim();
    if (!moduleName) continue;
    if (!groups.has(moduleName)) groups.set(moduleName, []);
    groups.get(moduleName).push({ name: file.name, load: async () => file });
  }
  return groups;
}

async function groupZipImages(zipFile) {
  const zip = await JSZip.loadAsync(zipFile);
  const entries = Object.values(zip.files).filter((entry) => !entry.dir && isImagePath(entry.name) && !entry.name.includes('__MACOSX/'));
  if (!entries.length) throw new Error('This ZIP does not contain any supported image files.');

  const paths = entries.map((entry) => entry.name.split('/').filter(Boolean));
  const firstFolder = paths[0][0];
  const hasCommonRoot = paths.every((parts) => parts[0] === firstFolder && parts.length > 2);
  const archiveName = zipFile.name.replace(/\.zip$/i, '').toLowerCase();
  const stripArchiveRoot = hasCommonRoot && firstFolder.toLowerCase() === archiveName;
  const moduleIndex = stripArchiveRoot ? 1 : 0;
  const groups = new Map();

  entries.forEach((entry, index) => {
    const moduleName = paths[index].slice(moduleIndex, -1).join(' / ').trim();
    if (!moduleName) return;
    if (!groups.has(moduleName)) groups.set(moduleName, []);
    groups.get(moduleName).push({
      name: paths[index].at(-1),
      load: async () => new File([await entry.async('blob')], paths[index].at(-1), {
        type: imageMimeType(paths[index].at(-1)),
      }),
    });
  });
  return groups;
}

function imageMimeType(filename) {
  const extension = filename.match(/\.[^.]+$/)?.[0].toLowerCase();
  return ({
    '.avif': 'image/avif', '.bmp': 'image/bmp', '.gif': 'image/gif', '.heic': 'image/heic',
    '.jpeg': 'image/jpeg', '.jpg': 'image/jpeg', '.png': 'image/png', '.tif': 'image/tiff',
    '.tiff': 'image/tiff', '.webp': 'image/webp',
  })[extension] || 'application/octet-stream';
}

function MainApp() {
  const [modules, setModules] = useState([]);
  const [selectedModuleId, setSelectedModuleId] = useState('');
  const [moduleName, setModuleName] = useState('');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [connected, setConnected] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [installPrompt, setInstallPrompt] = useState(null);
  const fileInput = useRef(null);
  const folderInput = useRef(null);
  const zipInput = useRef(null);
  const [viewerPhotoId, setViewerPhotoId] = useState('');
  const [importProgress, setImportProgress] = useState(null);
  const [importDragging, setImportDragging] = useState(false);
  const touchStartX = useRef(null);

  const selectedModule = modules.find((module) => module.id === selectedModuleId) || null;
  const photos = selectedModule?.entries || [];
  const filteredPhotos = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();
    if (!normalizedSearch) return photos;
    return photos.filter((photo) => photo.screenshotName.toLowerCase().includes(normalizedSearch));
  }, [photos, search]);
  const activePhotoIndex = filteredPhotos.findIndex((photo) => photo.id === viewerPhotoId);
  const activePhoto = activePhotoIndex >= 0 ? filteredPhotos[activePhotoIndex] : null;

  const refreshModules = async (selectId = selectedModuleId) => {
    const data = await fetchModulesWithEntries();
    setModules(data);
    setConnected(true);
    if (selectId && data.some((module) => module.id === selectId)) {
      setSelectedModuleId(selectId);
    } else if (!data.some((module) => module.id === selectedModuleId)) {
      setSelectedModuleId(data[0]?.id || '');
    }
  };

  useEffect(() => {
    if (supabaseConfigError) {
      setError(supabaseConfigError);
      setLoading(false);
      return;
    }

    refreshModules().catch((loadError) => {
      setConnected(false);
      setError(loadError.message || 'Could not load your cloud library.');
    })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!viewerPhotoId || activePhoto) return;
    setViewerPhotoId('');
  }, [activePhoto, viewerPhotoId]);

  useEffect(() => {
    if (!activePhoto) return undefined;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKeyDown = (event) => {
      if (event.key === 'Escape') setViewerPhotoId('');
      if (event.key === 'ArrowLeft') {
        event.preventDefault();
        moveViewer(-1);
      }
      if (event.key === 'ArrowRight') {
        event.preventDefault();
        moveViewer(1);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [activePhoto, activePhotoIndex, filteredPhotos]);

  useEffect(() => {
    const handleInstallPrompt = (event) => {
      event.preventDefault();
      setInstallPrompt(event);
    };
    window.addEventListener('beforeinstallprompt', handleInstallPrompt);
    return () => window.removeEventListener('beforeinstallprompt', handleInstallPrompt);
  }, []);

  const addModule = async (event) => {
    event.preventDefault();
    const name = moduleName.trim();
    if (!name) return;
    setError('');
    setNotice('');
    try {
      const module = await createModule(name);
      setModuleName('');
      await refreshModules(module.id);
      setNotice(`“${module.name}” is ready for photos.`);
    } catch (createError) {
      setError(createError.message || 'Could not create that module.');
    }
  };

  const uploadPhotos = async (fileList) => {
    const files = Array.from(fileList || []).filter((file) => file.type.startsWith('image/'));
    if (!selectedModule || !files.length || uploading) return;
    setUploading(true);
    setError('');
    setNotice('');
    let uploaded = 0;
    try {
      for (const file of files) {
        await uploadModulePhoto({ moduleId: selectedModule.id, slug: selectedModule.slug, file });
        uploaded += 1;
      }
      await refreshModules(selectedModule.id);
      setNotice(`${uploaded} photo${uploaded === 1 ? '' : 's'} uploaded to ${selectedModule.name}.`);
    } catch (uploadError) {
      await refreshModules(selectedModule.id).catch(() => {});
      setError(uploadError.message || `Uploaded ${uploaded} of ${files.length} photos. Try the rest again.`);
    } finally {
      setUploading(false);
      if (fileInput.current) fileInput.current.value = '';
    }
  };

  const importModuleGroups = async (groups, sourceLabel) => {
    const total = [...groups.values()].reduce((sum, files) => sum + files.length, 0);
    if (!total) {
      setError('No images were found. Choose a folder containing module folders and image files.');
      return;
    }

    setUploading(true);
    setError('');
    setNotice('');
    setImportProgress({ done: 0, total, moduleName: sourceLabel });
    let uploaded = 0;
    let firstModuleId = '';
    try {
      const knownModules = [...modules];
      for (const [name, photosToUpload] of groups) {
        let module = knownModules.find((item) => item.name.toLowerCase() === name.toLowerCase());
        if (!module) {
          module = await createModule(name);
          module = { ...module, entries: [] };
          knownModules.push(module);
        }
        if (!firstModuleId) firstModuleId = module.id;

        for (const photo of photosToUpload) {
          setImportProgress({ done: uploaded, total, moduleName: name, fileName: photo.name });
          const file = await photo.load();
          await uploadModulePhoto({ moduleId: module.id, slug: module.slug, file });
          uploaded += 1;
          setImportProgress({ done: uploaded, total, moduleName: name, fileName: photo.name });
        }
      }
      await refreshModules(firstModuleId || selectedModuleId);
      setNotice(`Imported ${uploaded} photo${uploaded === 1 ? '' : 's'} across ${groups.size} module${groups.size === 1 ? '' : 's'}.`);
    } catch (importError) {
      await refreshModules(firstModuleId || selectedModuleId).catch(() => {});
      setError(`${importError.message || 'Import stopped.'}${uploaded ? ` Uploaded ${uploaded} of ${total} photos.` : ''}`);
    } finally {
      setUploading(false);
      setImportProgress(null);
      if (folderInput.current) folderInput.current.value = '';
      if (zipInput.current) zipInput.current.value = '';
    }
  };

  const importFolder = async (fileList) => {
    const groups = groupFolderFiles(Array.from(fileList || []));
    await importModuleGroups(groups, 'folder');
  };

  const importZip = async (file) => {
    if (!file) return;
    setUploading(true);
    setError('');
    setNotice('Reading ZIP...');
    try {
      const groups = await groupZipImages(file);
      setUploading(false);
      await importModuleGroups(groups, file.name);
    } catch (importError) {
      setError(importError.message || 'Could not read this ZIP file.');
      setUploading(false);
      if (zipInput.current) zipInput.current.value = '';
    }
  };

  const moveViewer = (direction) => {
    if (filteredPhotos.length < 2 || activePhotoIndex < 0) return;
    const nextIndex = (activePhotoIndex + direction + filteredPhotos.length) % filteredPhotos.length;
    setViewerPhotoId(filteredPhotos[nextIndex].id);
  };

  const handleImportDrop = (event) => {
    event.preventDefault();
    setImportDragging(false);
    const files = Array.from(event.dataTransfer.files || []);
    const zipFile = files.find((file) => file.name.toLowerCase().endsWith('.zip'));
    if (zipFile) {
      importZip(zipFile);
    } else {
      setError('For a whole collection, choose the parent folder or drop a ZIP file here.');
    }
  };

  const removePhoto = async (photo) => {
    if (!window.confirm(`Remove “${photo.screenshotName}” from ${selectedModule.name}?`)) return;
    setError('');
    try {
      await deleteQuestionEntry(photo.id, photo.imagePath);
      if (viewerPhotoId === photo.id) setViewerPhotoId('');
      await refreshModules(selectedModule.id);
      setNotice('Photo removed.');
    } catch (deleteError) {
      setError(deleteError.message || 'Could not remove this photo.');
    }
  };

  const installApp = async () => {
    if (!installPrompt) return;
    await installPrompt.prompt();
    setInstallPrompt(null);
  };

  const totalPhotos = modules.reduce((count, module) => count + module.entries.length, 0);

  return (
    <div className="app-frame">
      <aside className="sidebar">
        <a className="brand" href="/" aria-label="KCQ Cloud home">
          <span className="brand-mark"><Images size={19} strokeWidth={2.2} /></span>
          <span className="brand-copy"><strong>KCQ Cloud</strong><small>YOUR IMAGE LIBRARY</small></span>
        </a>

        <div className="sidebar-section-heading">
          <span>YOUR MODULES</span><span className="module-total">{modules.length.toString().padStart(2, '0')}</span>
        </div>
        <form className="module-form" onSubmit={addModule}>
          <label className="sr-only" htmlFor="module-name">New module name</label>
          <input id="module-name" value={moduleName} onChange={(event) => setModuleName(event.target.value)} placeholder="Name a module" maxLength={80} />
          <button type="submit" className="add-module-button" disabled={!moduleName.trim()} aria-label="Create module" title="Create module"><Plus size={18} /></button>
        </form>

        <nav className="module-nav" aria-label="Modules">
          {modules.map((module) => (
            <button key={module.id} type="button" className={`module-link${module.id === selectedModuleId ? ' is-active' : ''}`} onClick={() => { setSelectedModuleId(module.id); setSearch(''); setNotice(''); setError(''); }}>
              <span className="module-dot" />
              <span className="module-link-name">{module.name}</span>
              <span className="module-photo-count">{module.entries.length}</span>
            </button>
          ))}
          {!loading && modules.length === 0 && <p className="sidebar-empty">Your first module starts here.</p>}
        </nav>

        <div className="sidebar-bottom">
          <div className="cloud-status"><span className={`status-light${connected ? '' : ' is-offline'}`} /><span>{connected ? 'Cloud connected' : 'Cloud not connected'}</span><Cloud size={15} /></div>
          <p>Your modules are shared across your devices.</p>
        </div>
      </aside>

      <main className="main-area">
        <header className="topbar">
          <div className="breadcrumb"><span>LIBRARY</span><span className="breadcrumb-slash">/</span><span>{selectedModule?.name || 'OVERVIEW'}</span></div>
          <div className="topbar-actions">
            {installPrompt && <button type="button" className="install-button" onClick={installApp}><ArrowDownToLine size={16} />Install app</button>}
            <span className="secure-chip"><Cloud size={15} />{connected ? 'Shared cloud library' : 'Cloud setup needed'}</span>
          </div>
        </header>

        <div className="content-wrap">
          <section className="welcome-row">
            <div>
              <p className="eyebrow">A LITTLE MORE ORGANIZED</p>
              <h1>{selectedModule?.name || 'Your image library'}</h1>
              <p className="welcome-copy">{selectedModule ? `${photos.length} ${photos.length === 1 ? 'photo' : 'photos'} in this module` : 'Keep every screenshot in its place.'}</p>
            </div>
            <div className="welcome-actions">
              <button type="button" className="import-action" onClick={() => folderInput.current?.click()} disabled={uploading}><FolderOpen size={16} />Import folder</button>
              <button type="button" className="import-action" onClick={() => zipInput.current?.click()} disabled={uploading}><Archive size={16} />Import ZIP</button>
              {selectedModule && <button type="button" className="primary-button" onClick={() => fileInput.current?.click()} disabled={uploading}>
                {uploading ? <LoaderCircle className="spin" size={18} /> : <Upload size={17} />}
                {uploading ? 'Uploading' : 'Upload photos'}
              </button>}
            </div>
            <input ref={fileInput} className="sr-only" type="file" accept="image/*" multiple onChange={(event) => uploadPhotos(event.target.files)} />
            <input ref={folderInput} className="sr-only" type="file" accept="image/*" multiple webkitdirectory="" directory="" onChange={(event) => importFolder(event.target.files)} />
            <input ref={zipInput} className="sr-only" type="file" accept=".zip,application/zip" onChange={(event) => importZip(event.target.files?.[0])} />
          </section>

          {(error || notice) && <div className={`feedback ${error ? 'feedback-error' : 'feedback-success'}`} role={error ? 'alert' : 'status'}>{error || notice}<button type="button" onClick={() => { setError(''); setNotice(''); }} aria-label="Dismiss message"><X size={16} /></button></div>}

          {importProgress && <div className="import-progress" role="status" aria-live="polite">
            <div className="import-progress-copy"><span>{importProgress.done} of {importProgress.total} photos</span><span>{importProgress.moduleName}{importProgress.fileName ? ` / ${importProgress.fileName}` : ''}</span></div>
            <div className="import-progress-track"><span style={{ width: `${(importProgress.done / importProgress.total) * 100}%` }} /></div>
          </div>}

          <section className={`collection-import${importDragging ? ' is-dragging' : ''}`} onDragEnter={(event) => { event.preventDefault(); setImportDragging(true); }} onDragOver={(event) => event.preventDefault()} onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setImportDragging(false); }} onDrop={handleImportDrop}>
            <span className="collection-import-icon"><FolderOpen size={19} /></span>
            <div className="collection-import-copy"><strong>{importDragging ? 'Drop your ZIP to import it' : 'Import a whole collection'}</strong><span>Choose a parent folder or a ZIP with one folder per module.</span></div>
            <span className="collection-import-hint">Module folders become modules</span>
          </section>

          {!selectedModule && !loading && (
            <section className="first-module glass-panel">
              <span className="first-module-icon"><ImagePlus size={24} /></span>
              <div><h2>Start with a module</h2><p>Create a module on the left. Then add photos to keep everything together.</p></div>
            </section>
          )}

          {selectedModule && (
            <>
              <section className={`upload-panel${dragging ? ' is-dragging' : ''}`} onDragEnter={(event) => { event.preventDefault(); setDragging(true); }} onDragOver={(event) => event.preventDefault()} onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setDragging(false); }} onDrop={(event) => { event.preventDefault(); setDragging(false); uploadPhotos(event.dataTransfer.files); }}>
                <div className="upload-symbol"><ImagePlus size={21} /></div>
                <div className="upload-copy"><strong>{dragging ? 'Drop to add to this module' : 'Add photos to this module'}</strong><span>Choose images or drag them into this space</span></div>
                <button type="button" className="browse-button" onClick={() => fileInput.current?.click()} disabled={uploading}>Browse files</button>
              </section>

              <div className="gallery-toolbar">
                <div className="gallery-title"><h2>Photos</h2><span>{photos.length}</span></div>
                <label className="search-box"><Search size={16} /><span className="sr-only">Search photos</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Find a photo" /></label>
              </div>

              {loading ? <div className="loading-state"><LoaderCircle className="spin" size={22} /><span>Loading your library</span></div> : filteredPhotos.length ? (
                <div className="photo-grid">
                  {filteredPhotos.map((photo) => (
                    <article className="photo-card" key={photo.id}>
                      <div className="photo-image-wrap"><button type="button" className="photo-open" onClick={() => setViewerPhotoId(photo.id)} aria-label={`Open ${photo.screenshotName}`}><img src={photo.screenshot} alt="" loading="lazy" /><span className="photo-open-hint"><Expand size={15} /></span></button><button type="button" className="photo-remove" title="Remove photo" aria-label={`Remove ${photo.screenshotName}`} onClick={() => removePhoto(photo)}><Trash2 size={16} /></button></div>
                      <div className="photo-caption"><span title={photo.screenshotName}>{photo.screenshotName || 'Untitled photo'}</span><time>{photo.createdAt ? new Date(photo.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : ''}</time></div>
                    </article>
                  ))}
                </div>
              ) : (
                <div className="empty-gallery"><span className="empty-icon"><Images size={24} /></span><h3>{search ? 'No photos found' : 'Nothing here yet'}</h3><p>{search ? 'Try a different file name.' : 'The photos you add to this module will appear here.'}</p></div>
              )}
            </>
          )}

          {!selectedModule && modules.length > 0 && <div className="overview-strip"><span><Images size={17} />{totalPhotos} photos across your library</span><span>Select a module to view its collection</span></div>}
          <footer className="page-footer"><span>KCQ CLOUD</span><span>One library, wherever you are.</span></footer>
        </div>
      </main>

      {activePhoto && <div className="photo-viewer" role="presentation" onClick={() => setViewerPhotoId('')}>
        <section className="viewer-dialog" role="dialog" aria-modal="true" aria-label={`Photo ${activePhotoIndex + 1} of ${filteredPhotos.length}`} onClick={(event) => event.stopPropagation()}>
          <header className="viewer-header">
            <div className="viewer-title"><strong>{activePhoto.screenshotName || 'Photo'}</strong><span>{selectedModule?.name} · {activePhotoIndex + 1} / {filteredPhotos.length}</span></div>
              <button type="button" className="viewer-close" onClick={() => setViewerPhotoId('')} aria-label="Close photo viewer" autoFocus><X size={21} /></button>
          </header>
          <div className="viewer-stage" onTouchStart={(event) => { touchStartX.current = event.touches[0].clientX; }} onTouchEnd={(event) => {
            if (touchStartX.current === null) return;
            const distance = event.changedTouches[0].clientX - touchStartX.current;
            if (Math.abs(distance) > 55) moveViewer(distance > 0 ? -1 : 1);
            touchStartX.current = null;
          }}>
            {filteredPhotos.length > 1 && <button type="button" className="viewer-nav viewer-previous" onClick={() => moveViewer(-1)} aria-label="Previous photo"><ChevronLeft size={26} /></button>}
            <img className="viewer-image" src={activePhoto.screenshot} alt={activePhoto.screenshotName || `Photo in ${selectedModule?.name}`} />
            {filteredPhotos.length > 1 && <button type="button" className="viewer-nav viewer-next" onClick={() => moveViewer(1)} aria-label="Next photo"><ChevronRight size={26} /></button>}
          </div>
          <footer className="viewer-footer"><span>Use ← → to browse, Esc to close</span><span>{activePhoto.createdAt ? new Date(activePhoto.createdAt).toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' }) : ''}</span></footer>
        </section>
      </div>}
    </div>
  );
}

export default function KcqApp() {
  return <MainApp />;
}
