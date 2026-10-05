import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDownToLine, Cloud, ImagePlus, Images, LoaderCircle, Plus, Search, Trash2, Upload, X } from 'lucide-react';
import { createModule, deleteQuestionEntry, fetchModulesWithEntries, uploadModulePhoto } from './lib/supabaseData';
import { supabaseConfigError } from './lib/supabaseClient';
import './kcq.css';

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

  const selectedModule = modules.find((module) => module.id === selectedModuleId) || null;
  const photos = selectedModule?.entries || [];
  const filteredPhotos = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();
    if (!normalizedSearch) return photos;
    return photos.filter((photo) => photo.screenshotName.toLowerCase().includes(normalizedSearch));
  }, [photos, search]);

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

  const removePhoto = async (photo) => {
    if (!window.confirm(`Remove “${photo.screenshotName}” from ${selectedModule.name}?`)) return;
    setError('');
    try {
      await deleteQuestionEntry(photo.id, photo.imagePath);
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
            {selectedModule && (
              <button type="button" className="primary-button" onClick={() => fileInput.current?.click()} disabled={uploading}>
                {uploading ? <LoaderCircle className="spin" size={18} /> : <Upload size={17} />}
                {uploading ? 'Uploading' : 'Upload photos'}
              </button>
            )}
            <input ref={fileInput} className="sr-only" type="file" accept="image/*" multiple onChange={(event) => uploadPhotos(event.target.files)} />
          </section>

          {(error || notice) && <div className={`feedback ${error ? 'feedback-error' : 'feedback-success'}`} role={error ? 'alert' : 'status'}>{error || notice}<button type="button" onClick={() => { setError(''); setNotice(''); }} aria-label="Dismiss message"><X size={16} /></button></div>}

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
                      <div className="photo-image-wrap"><img src={photo.screenshot} alt={photo.screenshotName || `Photo in ${selectedModule.name}`} loading="lazy" /><button type="button" className="photo-remove" title="Remove photo" aria-label={`Remove ${photo.screenshotName}`} onClick={() => removePhoto(photo)}><Trash2 size={16} /></button></div>
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
    </div>
  );
}

export default function KcqApp() {
  return <MainApp />;
}
