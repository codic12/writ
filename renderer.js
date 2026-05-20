const { ipcRenderer } = require('electron');
const path = require('path');
const TurndownService = require('turndown');

// Platform Detection
const isMac = process.platform === 'darwin';
if (isMac) document.body.classList.add('platform-mac');

// Window Controls
window.minimizeWindow = () => ipcRenderer.send('window-minimize');
window.maximizeWindow = () => ipcRenderer.send('window-maximize');
window.closeWindow = () => ipcRenderer.send('window-close');

let tabs = [];
let activeTabId = null;
let darkMode = localStorage.getItem('dark-mode') === 'true';
let currentScheme = localStorage.getItem('color-scheme') || 'scheme-default';
let zoomLevel = parseInt(localStorage.getItem('text-zoom')) || 0;
let notebooks = JSON.parse(localStorage.getItem('writ-notebooks')) || [{ id: 'default', name: 'My Notes', documents: [] }];
let scratchpad = JSON.parse(localStorage.getItem('writ-scratchpad')) || { id: 'scratchpad', name: 'Scratchpad', content: '<p><br></p>' };

const editor = document.getElementById('editor');

// --- Zoom Engine ---
function applyZoom() {
    const baseSize = 22;
    const newSize = baseSize + (zoomLevel * 2);
    editor.style.fontSize = `${newSize}px`;
    localStorage.setItem('text-zoom', zoomLevel);
}

function zoomIn() { if (zoomLevel < 10) { zoomLevel++; applyZoom(); } }
function zoomOut() { if (zoomLevel > -5) { zoomLevel--; applyZoom(); } }
function resetZoom() { zoomLevel = 0; applyZoom(); }

// --- Theme & Scheme Engine ---
const colorSchemes = {
    light: [
        { id: 'scheme-default', name: 'Default', colors: ['#ffffff', '#f5f5f7', '#007aff'] },
        { id: 'scheme-nord-light', name: 'Nord Light', colors: ['#eceff4', '#e5e9f0', '#88c0d0'] },
        { id: 'scheme-solarized-light', name: 'Solarized', colors: ['#fdf6e3', '#eee8d5', '#268bd2'] },
        { id: 'scheme-sepia', name: 'Sepia', colors: ['#f4ecd8', '#e7dcb9', '#704214'] },
        { id: 'scheme-rose-pine-dawn', name: 'Rosé Pine', colors: ['#faf4ed', '#f2e9e1', '#d7827e'] },
        { id: 'scheme-everforest-light', name: 'Everforest', colors: ['#f8f5e4', '#f2efdf', '#8da101'] }
    ],
    dark: [
        { id: 'scheme-default', name: 'Default Dark', colors: ['#1a1a1a', '#252525', '#0a84ff'] },
        { id: 'scheme-nord-dark', name: 'Nord Dark', colors: ['#2e3440', '#3b4252', '#88c0d0'] },
        { id: 'scheme-gruvbox-dark', name: 'Gruvbox', colors: ['#282828', '#1d2021', '#d79921'] },
        { id: 'scheme-rose-pine-dark', name: 'Rosé Pine', colors: ['#191724', '#1f1d2e', '#ebbcba'] },
        { id: 'scheme-everforest-dark', name: 'Everforest', colors: ['#2d353b', '#232a2e', '#a7c080'] },
        { id: 'scheme-catppuccin-mocha', name: 'Catppuccin', colors: ['#1e1e2e', '#181825', '#cba6f7'] }
    ]
};

function applyTheme() {
    document.body.classList.toggle('dark-mode', darkMode);
    Object.values(colorSchemes).flat().forEach(s => document.body.classList.remove(s.id));
    document.body.classList.add(currentScheme);
    
    const lightBtn = document.getElementById('theme-light-btn');
    const darkBtn = document.getElementById('theme-dark-btn');
    if (lightBtn) lightBtn.classList.toggle('active', !darkMode);
    if (darkBtn) darkBtn.classList.toggle('active', darkMode);
    renderSchemeList();
}

function setThemeMode(mode) {
    darkMode = (mode === 'dark');
    localStorage.setItem('dark-mode', darkMode);
    
    const currentName = Object.values(colorSchemes).flat().find(s => s.id === currentScheme)?.name;
    const newSchemes = darkMode ? colorSchemes.dark : colorSchemes.light;
    const match = newSchemes.find(s => s.name === currentName);
    if (match) currentScheme = match.id;
    else currentScheme = 'scheme-default';
    
    localStorage.setItem('color-scheme', currentScheme);
    applyTheme();
}

function setColorScheme(schemeId) {
    currentScheme = schemeId;
    localStorage.setItem('color-scheme', currentScheme);
    applyTheme();
}

function renderSchemeList() {
    const container = document.getElementById('scheme-list');
    if (!container) return;
    container.innerHTML = '';
    const schemes = darkMode ? colorSchemes.dark : colorSchemes.light;
    schemes.forEach(scheme => {
        const div = document.createElement('div');
        div.className = `scheme-item ${currentScheme === scheme.id ? 'active' : ''}`;
        div.innerHTML = `
            <div class="scheme-preview">
                <div style="flex:2; background:${scheme.colors[0]}"></div>
                <div style="flex:1; background:${scheme.colors[1]}"></div>
                <div style="width:4px; background:${scheme.colors[2]}"></div>
            </div>
            <span class="scheme-name">${scheme.name}</span>
        `;
        div.onclick = () => setColorScheme(scheme.id);
        container.appendChild(div);
    });
}

function updateModalState() {
    document.body.classList.toggle('modal-open', preferencesVisible || commandPaletteVisible);
}

// --- Preferences Modal ---
let preferencesVisible = false;
function togglePreferences(force = null) {
    const nextState = force !== null ? force : !preferencesVisible;
    if (nextState === preferencesVisible) return;
    
    if (nextState && commandPaletteVisible) toggleCommandPalette(false);
    
    preferencesVisible = nextState;
    const modal = document.getElementById('preferences-modal');
    modal.classList.toggle('visible', preferencesVisible);
    updateModalState();
    if (preferencesVisible) {
        renderSchemeList();
    }
}

// IPC from Main Menu
ipcRenderer.on('menu-action', (event, action) => {
    switch (action) {
        case 'new-note': createNewDocument(); break;
        case 'open-file': openFile(); break;
        case 'save-file': saveFile(); break;
        case 'export-md': exportMarkdown(); break;
        case 'export-html': exportHTML(); break;
        case 'toggle-sidebar': toggleSidebar(); break;
        case 'toggle-focus': toggleFocusMode(); break;
        case 'open-preferences': if (!preferencesVisible) togglePreferences(true); break;
        case 'toggle-palette': toggleCommandPalette(); break;
    }
});

// --- Export Engine ---
const turndownService = new TurndownService({
    headingStyle: 'atx',
    codeBlockStyle: 'fenced'
});

async function exportMarkdown() {
    if (!activeTabId) return;
    const tab = (activeTabId === 'scratchpad') ? scratchpad : tabs.find(t => t.id === activeTabId);
    const html = editor.innerHTML;
    const markdown = turndownService.turndown(html);
    const fileName = tab.fileName || tab.name || 'Untitled';
    const defaultPath = fileName.endsWith('.md') ? fileName : `${fileName}.md`;
    await ipcRenderer.invoke('save-file', markdown, defaultPath);
}

async function exportHTML() {
    if (!activeTabId) return;
    const tab = (activeTabId === 'scratchpad') ? scratchpad : tabs.find(t => t.id === activeTabId);
    const htmlContent = editor.innerHTML;
    const fileName = tab.fileName || tab.name || 'Untitled';
    const fullHTML = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><title>${fileName}</title><style>body { font-family: Georgia, serif; line-height: 1.8; color: #2c2c2c; max-width: 700px; margin: 50px auto; padding: 40px; background: #fdfdfd; }h1 { border-bottom: 1px solid #eee; padding-bottom: 10px; }h2 { border-bottom: 1px solid #eee; padding-bottom: 5px; margin-top: 40px; }blockquote { border-left: 4px solid #eee; padding-left: 20px; color: #666; font-style: italic; }code { background: #f4f4f4; padding: 2px 5px; border-radius: 3px; font-family: monospace; }ul, ol { margin-bottom: 20px; }li { margin-bottom: 8px; }</style></head><body>${htmlContent}</body></html>`;
    const defaultPath = fileName.endsWith('.html') ? fileName : `${fileName}.html`;
    await ipcRenderer.invoke('save-file', fullHTML, defaultPath);
}

// --- App Functions ---
function format(command, value = null) {
    document.execCommand(command, false, value);
    editor.focus();
}

function toggleSidebar() {
    const sidebar = document.getElementById('sidebar');
    sidebar.classList.toggle('hidden');
    localStorage.setItem('sidebar-hidden', sidebar.classList.contains('hidden'));
}

function switchTab(id) {
    if (activeTabId === id) return;

    if (activeTabId) {
        if (activeTabId === 'scratchpad') {
            scratchpad.content = editor.innerHTML;
            localStorage.setItem('writ-scratchpad', JSON.stringify(scratchpad));
        } else {
            const currentTab = tabs.find(t => t.id === activeTabId);
            if (currentTab) currentTab.content = editor.innerHTML;
        }
    }
    
    activeTabId = id;
    const tab = (id === 'scratchpad') ? scratchpad : tabs.find(t => t.id === id);
    if (tab) {
        let content = (tab.content || '').trim();
        if (id !== 'scratchpad') {
            content = content.replace(/^(<p>\s*<br\s*\/?>\s*<\/p>|<br\s*\/?>)+/gi, '');
        }
        
        editor.innerHTML = content;
        
        if (id !== 'scratchpad') {
            const headers = editor.querySelectorAll('h1');
            if (headers.length === 0) {
                editor.insertAdjacentHTML('afterbegin', `<h1 class="note-title">${tab.fileName || tab.name}</h1>`);
            } else {
                headers[0].classList.add('note-title');
                for (let i = 1; i < headers.length; i++) {
                    if (headers[i].classList.contains('note-title')) {
                        headers[i].outerHTML = headers[i].innerHTML;
                    }
                }
            }
        } else {
            const header = editor.querySelector('.note-title');
            if (header) header.remove();
        }
        
        document.getElementById('file-path').textContent = tab.filePath || tab.fileName || tab.name;
        updateWordCount();
    }
    renderTabs(); renderFileList();
    editor.focus();
}

function createTab(filePath = null, content = '', id = null, name = null) {
    const tabId = id || Date.now().toString();
    const existing = tabs.find(t => t.id === tabId || (filePath && t.filePath === filePath));
    if (existing) { switchTab(existing.id); return; }
    
    const fileName = filePath ? path.basename(filePath) : (name || 'Untitled');
    let finalContent = content.trim();

    if (!filePath && tabId !== 'scratchpad') {
        if (!finalContent.includes('note-title') && !finalContent.startsWith('<h1')) {
            finalContent = `<h1 class="note-title">${fileName}</h1><p><br></p>` + finalContent;
        }
    }
    
    const tab = { id: tabId, filePath, fileName, content: finalContent };
    tabs.push(tab);
    switchTab(tabId);
    renderTabs(); renderFileList();
}

function closeTab(id, e) {
    if (e) e.stopPropagation();
    if (id === 'scratchpad') return;
    const index = tabs.findIndex(t => t.id === id);
    if (index === -1) return;
    tabs.splice(index, 1);
    if (activeTabId === id) {
        if (tabs.length > 0) switchTab(tabs[Math.max(0, index - 1)].id);
        else switchTab('scratchpad');
    }
    renderTabs(); renderFileList();
}

function renderTabs() {
    const container = document.getElementById('tab-container');
    container.innerHTML = '';
    
    if (activeTabId === 'scratchpad') {
        const div = document.createElement('div');
        div.className = 'tab active';
        const span = document.createElement('span');
        span.textContent = 'Scratchpad';
        div.appendChild(span);
        div.onclick = () => switchTab('scratchpad');
        container.appendChild(div);
    }

    tabs.forEach(tab => {
        const div = document.createElement('div');
        div.className = `tab ${tab.id === activeTabId ? 'active' : ''}`;
        const span = document.createElement('span');
        span.textContent = tab.fileName;
        div.appendChild(span);
        const closeSpan = document.createElement('span');
        closeSpan.className = 'close-tab';
        closeSpan.textContent = '×';
        closeSpan.onclick = (e) => closeTab(tab.id, e);
        div.appendChild(closeSpan);
        div.onclick = () => switchTab(tab.id);
        container.appendChild(div);
    });
}

function toggleNotebook(notebookId, e) {
    if (e) e.stopPropagation();
    const notebook = notebooks.find(n => n.id === notebookId);
    if (notebook) {
        notebook.collapsed = !notebook.collapsed;
        saveNotebooks(); renderFileList();
    }
}

function deleteNotebook(notebookId, e) {
    if (e) e.stopPropagation();
    if (notebooks.length <= 1) return; 
    if (confirm('Delete this notebook and all its notes?')) {
        const index = notebooks.findIndex(n => n.id === notebookId);
        if (index !== -1) {
            const notebook = notebooks[index];
            notebook.documents.forEach(doc => {
                if (tabs.find(t => t.id === doc.id)) closeTab(doc.id);
            });
            notebooks.splice(index, 1);
            saveNotebooks(); renderFileList();
        }
    }
}

function deleteDocument(notebookId, docId, e) {
    if (e) e.stopPropagation();
    if (confirm('Delete this note?')) {
        const notebook = notebooks.find(n => n.id === notebookId);
        if (notebook) {
            const docIndex = notebook.documents.findIndex(d => d.id === docId);
            if (docIndex !== -1) {
                notebook.documents.splice(docIndex, 1);
                closeTab(docId);
                saveNotebooks(); renderFileList();
            }
        }
    }
}

function renderFileList() {
    const container = document.getElementById('file-list');
    container.innerHTML = '';

    const scratchDiv = document.createElement('div');
    scratchDiv.className = `file-item ${activeTabId === 'scratchpad' ? 'active' : ''}`;
    scratchDiv.style.fontWeight = '600';
    scratchDiv.style.marginBottom = '15px';
    scratchDiv.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="margin-right:8px; opacity:0.7;"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg><span>Scratchpad</span>`;
    scratchDiv.onclick = () => switchTab('scratchpad');
    container.appendChild(scratchDiv);

    notebooks.forEach(notebook => {
        const notebookDiv = document.createElement('div');
        notebookDiv.className = `notebook-item ${notebook.collapsed ? 'collapsed' : ''}`;
        
        const header = document.createElement('div');
        header.className = 'notebook-header';
        header.onclick = (e) => toggleNotebook(notebook.id, e);
        header.oncontextmenu = (e) => showNotebookRename(e, notebook.id);
        
        const collapseIcon = document.createElement('div');
        collapseIcon.className = 'collapse-icon';
        collapseIcon.innerHTML = `<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>`;
        header.appendChild(collapseIcon);

        const titleSpan = document.createElement('span');
        titleSpan.className = 'notebook-title';
        titleSpan.textContent = notebook.name;
        header.appendChild(titleSpan);
        
        const actions = document.createElement('div');
        actions.className = 'actions';
        
        const addBtn = document.createElement('button');
        addBtn.title = 'New Document';
        addBtn.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>`;
        addBtn.onclick = (e) => createNewDocument(notebook.id, e);
        actions.appendChild(addBtn);

        const delBtn = document.createElement('button');
        delBtn.title = 'Delete Notebook';
        delBtn.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>`;
        delBtn.onclick = (e) => deleteNotebook(notebook.id, e);
        actions.appendChild(delBtn);

        header.appendChild(actions);
        notebookDiv.appendChild(header);
        
        const docsContainer = document.createElement('div');
        docsContainer.className = 'notebook-docs';
        notebook.documents.forEach(doc => {
            const docDiv = document.createElement('div');
            docDiv.className = `file-item document-item ${activeTabId === doc.id ? 'active' : ''}`;
            
            const docSpan = document.createElement('span');
            docSpan.textContent = doc.name;
            docDiv.appendChild(docSpan);

            const docActions = document.createElement('div');
            docActions.className = 'actions';
            
            const docDelBtn = document.createElement('button');
            docDelBtn.title = 'Delete Note';
            docDelBtn.innerHTML = `<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>`;
            docDelBtn.onclick = (e) => deleteDocument(notebook.id, doc.id, e);
            docActions.appendChild(docDelBtn);
            
            docDiv.appendChild(docActions);
            
            docDiv.onclick = () => createTab(null, doc.content, doc.id, doc.name);
            docDiv.oncontextmenu = (e) => showRenameInput(doc, e);
            docsContainer.appendChild(docDiv);
        });
        notebookDiv.appendChild(docsContainer);
        container.appendChild(notebookDiv);
    });
}

function saveNotebooks() { localStorage.setItem('writ-notebooks', JSON.stringify(notebooks)); }

// --- Command Palette Engine ---
let commandPaletteVisible = false;
let commandResults = [];
let selectedCommandIndex = 0;
const fileIcon = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="opacity: 0.5;"><path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"></path><polyline points="13 2 13 9 20 9"></polyline></svg>`;
const actionIcon = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="opacity: 0.5;"><polyline points="4 17 10 11 4 5"></polyline><line x1="12" y1="19" x2="20" y2="19"></line></svg>`;

function toggleCommandPalette(force = null) {
    const nextState = force !== null ? force : !commandPaletteVisible;
    if (nextState === commandPaletteVisible) return;

    if (nextState && preferencesVisible) togglePreferences(false);
    
    const palette = document.getElementById('command-palette');
    const input = document.getElementById('command-input');
    commandPaletteVisible = nextState;
    palette.classList.toggle('visible', commandPaletteVisible);
    updateModalState();
    if (commandPaletteVisible) { input.value = ''; input.focus(); updateCommandResults(); }
}

function updateCommandResults() {
    const query = document.getElementById('command-input').value.toLowerCase();
    commandResults = [];
    
    if ("scratchpad".includes(query)) {
        commandResults.push({ title: 'Scratchpad', meta: 'Quick notes', type: 'document', icon: fileIcon, action: () => switchTab('scratchpad') });
    }

    notebooks.forEach(nb => {
        nb.documents.forEach(doc => {
            if (doc.name.toLowerCase().includes(query)) {
                commandResults.push({ title: doc.name, meta: `in ${nb.name}`, type: 'document', icon: fileIcon, action: () => createTab(null, doc.content, doc.id, doc.name) });
            }
        });
    });
    const cmds = [
        { title: 'New Note', meta: 'Create draft', type: 'action', icon: actionIcon, action: () => createNewDocument() },
        { title: 'Open File', meta: 'Load from computer', type: 'action', icon: actionIcon, action: () => openFile() },
        { title: 'Save File', meta: 'Persist current draft', type: 'action', icon: actionIcon, action: () => saveFile() },
        { title: 'Export as Markdown', meta: 'Convert to .md', type: 'action', icon: actionIcon, action: () => exportMarkdown() },
        { title: 'Export as HTML', meta: 'Save as webpage', type: 'action', icon: actionIcon, action: () => exportHTML() },
        { title: 'Preferences', meta: 'Settings & Themes', type: 'action', icon: actionIcon, action: () => togglePreferences(true) },
        { title: 'Toggle Theme', meta: 'Switch mode', type: 'action', icon: actionIcon, action: () => toggleTheme() },
        { title: 'Toggle Focus Mode', meta: 'Enter/Exit distraction-free', type: 'action', icon: actionIcon, action: () => toggleFocusMode() },
        { title: 'Toggle Sidebar', meta: 'Show/Hide library', type: 'action', icon: actionIcon, action: () => toggleSidebar() }
    ];
    cmds.forEach(c => { if (c.title.toLowerCase().includes(query)) commandResults.push(c); });
    selectedCommandIndex = 0; renderCommandResults();
}

function renderCommandResults() {
    const container = document.getElementById('command-results');
    container.innerHTML = '';
    commandResults.forEach((result, index) => {
        const div = document.createElement('div');
        div.className = `command-item ${index === selectedCommandIndex ? 'selected' : ''}`;
        div.innerHTML = `<div style="display:flex; align-items:center; gap:12px;">${result.icon}<div style="display:flex; flex-direction:column; gap:2px;"><span class="command-item-title">${result.title}</span><span class="command-item-meta">${result.meta}</span></div></div>`;
        div.onclick = () => { result.action(); toggleCommandPalette(false); };
        container.appendChild(div);
    });
}

document.getElementById('command-input').addEventListener('input', updateCommandResults);
document.getElementById('command-input').addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); selectedCommandIndex = (selectedCommandIndex + 1) % commandResults.length; renderCommandResults(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); selectedCommandIndex = (selectedCommandIndex - 1 + commandResults.length) % commandResults.length; renderCommandResults(); }
    else if (e.key === 'Enter') { 
        if (commandResults[selectedCommandIndex]) { 
            e.preventDefault();
            commandResults[selectedCommandIndex].action(); 
            toggleCommandPalette(false); 
        }
    }
    else if (e.key === 'Escape') toggleCommandPalette(false);
});

window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        if (preferencesVisible) togglePreferences(false);
        else if (commandPaletteVisible) toggleCommandPalette(false);
    }
});

async function saveFile() {
    if (!activeTabId) return;
    const tab = (activeTabId === 'scratchpad') ? scratchpad : tabs.find(t => t.id === activeTabId);
    const content = editor.innerHTML;
    const result = await ipcRenderer.invoke('save-file', content);
    if (result) {
        if (activeTabId !== 'scratchpad') {
            tab.filePath = result; tab.fileName = path.basename(result);
            document.getElementById('file-path').textContent = result;
            renderTabs(); renderFileList();
        }
    }
}

async function openFile() {
    const result = await ipcRenderer.invoke('open-file');
    if (result) {
        const parser = new DOMParser();
        const doc = parser.parseFromString(result.content, 'text/html');
        const sanitizedContent = doc.body.innerText;
        createTab(result.filePath, sanitizedContent);
    }
}

function toggleTheme() { setThemeMode(darkMode ? 'light' : 'dark'); }
function toggleFocusMode() { document.body.classList.toggle('focus-mode'); }
function updateWordCount() {
    const words = editor.innerText.trim().split(/\s+/).filter(w => w.length > 0);
    document.getElementById('word-count').textContent = `${words.length} words`;
}

const selectionMenu = document.getElementById('selection-menu');

function updateSelectionMenu() {
    const selection = window.getSelection();
    if (selection.isCollapsed || selection.rangeCount === 0 || !editor.contains(selection.anchorNode)) {
        selectionMenu.style.display = 'none';
        return;
    }
    const range = selection.getRangeAt(0);
    const rect = range.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) { selectionMenu.style.display = 'none'; return; }
    selectionMenu.style.display = 'flex';
    selectionMenu.style.left = `${rect.left + rect.width / 2 - selectionMenu.offsetWidth / 2}px`;
    selectionMenu.style.top = `${rect.top - selectionMenu.offsetHeight - 10}px`;
}

document.addEventListener('selectionchange', updateSelectionMenu);
window.addEventListener('mousedown', (e) => {
    if (!selectionMenu.contains(e.target)) {
        setTimeout(() => { if (window.getSelection().isCollapsed) selectionMenu.style.display = 'none'; }, 100);
    }
});

editor.addEventListener('input', () => {
    updateWordCount();
    if (activeTabId) {
        if (activeTabId === 'scratchpad') {
            scratchpad.content = editor.innerHTML;
            localStorage.setItem('writ-scratchpad', JSON.stringify(scratchpad));
            return;
        }

        const tab = tabs.find(t => t.id === activeTabId);
        if (tab) {
            const titleHeader = editor.querySelector('.note-title');
            if (titleHeader) {
                const newName = titleHeader.innerText.trim() || 'Untitled';
                if (tab.fileName !== newName) {
                    tab.fileName = newName;
                    notebooks.forEach(nb => {
                        const doc = nb.documents.find(d => d.id === tab.id);
                        if (doc) doc.name = newName;
                    });
                    renderFileList(); renderTabs();
                }
            }

            tab.content = editor.innerHTML;
            notebooks.forEach(nb => {
                const doc = nb.documents.find(d => d.id === tab.id);
                if (doc) doc.content = tab.content;
            });
            saveNotebooks();
        }
    }
});

editor.addEventListener('keydown', (e) => {
    const selection = window.getSelection();
    if (selection.rangeCount > 0) {
        const range = selection.getRangeAt(0);
        const titleHeader = editor.querySelector('.note-title');
        
        if (titleHeader && (e.key === 'Backspace' || e.key === 'Delete')) {
            if (editor.childNodes.length === 1 && editor.firstChild === titleHeader && titleHeader.innerText.trim() === '' && e.key === 'Backspace') {
                e.preventDefault();
            }
        }
        
        if (e.key === 'Enter' && (range.startContainer === titleHeader || titleHeader.contains(range.startContainer))) {
            e.preventDefault();
            const nextElem = titleHeader.nextElementSibling || editor.appendChild(document.createElement('p'));
            const newRange = document.createRange();
            newRange.setStart(nextElem, 0);
            newRange.collapse(true);
            selection.removeAllRanges();
            selection.addRange(newRange);
        }
    }
});

editor.addEventListener('paste', (e) => {
    e.preventDefault();
    const text = (e.originalEvent || e).clipboardData.getData('text/plain');
    document.execCommand('insertText', false, text);
});

window.onload = () => {
    const sidebar = document.getElementById('sidebar');
    if (localStorage.getItem('sidebar-hidden') === 'true') sidebar.classList.add('hidden');
    
    const saved = localStorage.getItem('writ-session');
    if (saved) {
        const session = JSON.parse(saved);
        tabs = session.tabs || [];
        switchTab(session.activeTabId || 'scratchpad');
    } else {
        switchTab('scratchpad');
    }
    
    renderFileList();
    applyTheme();
    applyZoom();
};

window.onbeforeunload = () => { localStorage.setItem('writ-session', JSON.stringify({ tabs, activeTabId })); };

document.addEventListener('keydown', (e) => {
    if (e.metaKey || e.ctrlKey) {
        if (e.key === 'p' || e.key === 'k') { e.preventDefault(); toggleCommandPalette(); }
        if (e.key === ',') { e.preventDefault(); togglePreferences(true); }
        
        if (e.key === '=' || e.key === '+') { e.preventDefault(); zoomIn(); }
        if (e.key === '-') { e.preventDefault(); zoomOut(); }
        if (e.key === '0') { e.preventDefault(); resetZoom(); }

        switch (e.key.toLowerCase()) {
            case 's': e.preventDefault(); saveFile(); break;
            case 'o': e.preventDefault(); openFile(); break;
            case 'n': e.preventDefault(); createNewDocument(); break;
            case 't': e.preventDefault(); createNewDocument(); break;
            case 'w': e.preventDefault(); closeTab(activeTabId); break;
            case 'b': e.preventDefault(); format('bold'); break;
            case 'i': e.preventDefault(); format('italic'); break;
            case '\\': e.preventDefault(); toggleSidebar(); break;
            case 'f': e.preventDefault(); toggleFocusMode(); break;
        }
    }
});
