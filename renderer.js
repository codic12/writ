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
let notebooks = JSON.parse(localStorage.getItem('writ-notebooks')) || [{ id: 'default', name: 'My Notes', documents: [] }];

const editor = document.getElementById('editor');

// Initialize Theme
if (darkMode) document.body.classList.add('dark-mode');

// --- Export Engine ---
const turndownService = new TurndownService({
    headingStyle: 'atx',
    codeBlockStyle: 'fenced'
});

async function exportMarkdown() {
    if (!activeTabId) return;
    const tab = tabs.find(t => t.id === activeTabId);
    const html = editor.innerHTML;
    const markdown = turndownService.turndown(html);
    const defaultPath = tab.fileName.endsWith('.md') ? tab.fileName : `${tab.fileName}.md`;
    await ipcRenderer.invoke('save-file', markdown, defaultPath);
}

async function exportHTML() {
    if (!activeTabId) return;
    const tab = tabs.find(t => t.id === activeTabId);
    const htmlContent = editor.innerHTML;
    const fullHTML = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><title>${tab.fileName}</title><style>body { font-family: Georgia, serif; line-height: 1.8; color: #2c2c2c; max-width: 700px; margin: 50px auto; padding: 40px; background: #fdfdfd; }h1 { border-bottom: 1px solid #eee; padding-bottom: 10px; }h2 { border-bottom: 1px solid #eee; padding-bottom: 5px; margin-top: 40px; }blockquote { border-left: 4px solid #eee; padding-left: 20px; color: #666; font-style: italic; }code { background: #f4f4f4; padding: 2px 5px; border-radius: 3px; font-family: monospace; }ul, ol { margin-bottom: 20px; }li { margin-bottom: 8px; }</style></head><body>${htmlContent}</body></html>`;
    const defaultPath = tab.fileName.endsWith('.html') ? tab.fileName : `${tab.fileName}.html`;
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

function createTab(filePath = null, content = '', id = null, name = null) {
    const tabId = id || Date.now().toString();
    const existing = tabs.find(t => t.id === tabId || (filePath && t.filePath === filePath));
    if (existing) { switchTab(existing.id); return; }
    const fileName = filePath ? path.basename(filePath) : (name || 'Untitled');
    const tab = { id: tabId, filePath, fileName, content: content || '' };
    tabs.push(tab);
    switchTab(tabId);
    renderTabs(); renderFileList();
}

function switchTab(id) {
    if (activeTabId) {
        const currentTab = tabs.find(t => t.id === activeTabId);
        if (currentTab) currentTab.content = editor.innerHTML;
    }
    activeTabId = id;
    const tab = tabs.find(t => t.id === id);
    if (tab) {
        editor.innerHTML = tab.content;
        document.getElementById('file-path').textContent = tab.filePath || tab.fileName;
        updateWordCount();
    }
    renderTabs(); renderFileList();
    editor.focus();
}

function closeTab(id, e) {
    if (e) e.stopPropagation();
    const index = tabs.findIndex(t => t.id === id);
    if (index === -1) return;
    tabs.splice(index, 1);
    if (activeTabId === id) {
        if (tabs.length > 0) switchTab(tabs[Math.max(0, index - 1)].id);
        else { activeTabId = null; editor.innerHTML = ''; document.getElementById('file-path').textContent = 'No file open'; }
    }
    renderTabs(); renderFileList();
}

function renderTabs() {
    const container = document.getElementById('tab-container');
    container.innerHTML = '';
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

function renderFileList() {
    const container = document.getElementById('file-list');
    container.innerHTML = '';
    notebooks.forEach(notebook => {
        const notebookDiv = document.createElement('div');
        notebookDiv.className = 'notebook-item';
        const header = document.createElement('div');
        header.className = 'notebook-header';
        header.oncontextmenu = (e) => showNotebookRename(e, notebook.id);
        const titleSpan = document.createElement('span');
        titleSpan.textContent = notebook.name;
        header.appendChild(titleSpan);
        const addBtn = document.createElement('button');
        addBtn.title = 'New Document';
        addBtn.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>`;
        addBtn.onclick = (e) => createNewDocument(notebook.id, e);
        header.appendChild(addBtn);
        notebookDiv.appendChild(header);
        const docsContainer = document.createElement('div');
        docsContainer.className = 'notebook-docs';
        notebook.documents.forEach(doc => {
            const docDiv = document.createElement('div');
            docDiv.className = `file-item document-item ${activeTabId === doc.id ? 'active' : ''}`;
            docDiv.textContent = doc.name;
            docDiv.onclick = () => createTab(null, doc.content, doc.id, doc.name);
            docDiv.oncontextmenu = (e) => showRenameInput(doc, e);
            docsContainer.appendChild(docDiv);
        });
        notebookDiv.appendChild(docsContainer);
        container.appendChild(notebookDiv);
    });
}

function createNewNotebook() {
    const id = Date.now().toString();
    notebooks.push({ id, name: `Notebook ${notebooks.length + 1}`, documents: [] });
    saveNotebooks(); renderFileList();
}

function createNewDocument(notebookId, e) {
    if (e) e.stopPropagation();
    let notebook = notebooks.find(n => n.id === notebookId) || notebooks[0];
    if (notebook) {
        const newDoc = { id: Date.now().toString(), name: 'Untitled', content: '' };
        notebook.documents.push(newDoc);
        saveNotebooks(); createTab(null, '', newDoc.id, newDoc.name);
    }
}

function showRenameInput(doc, e) {
    e.preventDefault();
    const target = e.target;
    const oldName = target.textContent;
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'rename-input';
    input.value = oldName;
    target.innerHTML = '';
    target.appendChild(input);
    input.focus(); input.select();
    const finishRename = () => {
        const newName = input.value.trim() || oldName;
        doc.name = newName;
        const tab = tabs.find(t => t.id === doc.id);
        if (tab) tab.fileName = newName;
        saveNotebooks(); renderFileList(); renderTabs();
    };
    input.onblur = finishRename;
    input.onkeydown = (ke) => { if (ke.key === 'Enter') finishRename(); if (ke.key === 'Escape') { input.value = oldName; finishRename(); }};
}

function showNotebookRename(e, notebookId) {
    e.preventDefault();
    const notebook = notebooks.find(n => n.id === notebookId);
    if (!notebook) return;
    const target = e.currentTarget.querySelector('span');
    const oldName = target.textContent;
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'rename-input';
    input.value = oldName;
    input.style.margin = '0';
    input.style.width = '100px';
    target.innerHTML = '';
    target.appendChild(input);
    input.focus(); input.select();
    const finishRename = () => {
        notebook.name = input.value.trim() || oldName;
        saveNotebooks(); renderFileList();
    };
    input.onblur = finishRename;
    input.onkeydown = (ke) => { if (ke.key === 'Enter') finishRename(); if (ke.key === 'Escape') { input.value = oldName; finishRename(); }};
}

function saveNotebooks() { localStorage.setItem('writ-notebooks', JSON.stringify(notebooks)); }

// --- Command Palette Engine ---
let commandPaletteVisible = false;
let commandResults = [];
let selectedCommandIndex = 0;
const fileIcon = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="opacity: 0.5;"><path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"></path><polyline points="13 2 13 9 20 9"></polyline></svg>`;
const actionIcon = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="opacity: 0.5;"><polyline points="4 17 10 11 4 5"></polyline><line x1="12" y1="19" x2="20" y2="19"></line></svg>`;

function toggleCommandPalette() {
    const palette = document.getElementById('command-palette');
    const input = document.getElementById('command-input');
    commandPaletteVisible = !commandPaletteVisible;
    palette.style.display = commandPaletteVisible ? 'flex' : 'none';
    document.body.classList.toggle('palette-open', commandPaletteVisible);
    if (commandPaletteVisible) { input.value = ''; input.focus(); updateCommandResults(); }
}

function updateCommandResults() {
    const query = document.getElementById('command-input').value.toLowerCase();
    commandResults = [];
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
        div.onclick = () => { result.action(); toggleCommandPalette(); };
        container.appendChild(div);
    });
}

document.getElementById('command-input').addEventListener('input', updateCommandResults);
document.getElementById('command-input').addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); selectedCommandIndex = (selectedCommandIndex + 1) % commandResults.length; renderCommandResults(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); selectedCommandIndex = (selectedCommandIndex - 1 + commandResults.length) % commandResults.length; renderCommandResults(); }
    else if (e.key === 'Enter') { if (commandResults[selectedCommandIndex]) { commandResults[selectedCommandIndex].action(); toggleCommandPalette(); }}
    else if (e.key === 'Escape') toggleCommandPalette();
});

async function saveFile() {
    if (!activeTabId) return;
    const tab = tabs.find(t => t.id === activeTabId);
    const content = editor.innerHTML;
    const result = await ipcRenderer.invoke('save-file', content);
    if (result) {
        tab.filePath = result; tab.fileName = path.basename(result);
        document.getElementById('file-path').textContent = result;
        renderTabs(); renderFileList();
    }
}

async function openFile() {
    const result = await ipcRenderer.invoke('open-file');
    if (result) {
        // Sanitize same way as paste: extract only the text
        const parser = new DOMParser();
        const doc = parser.parseFromString(result.content, 'text/html');
        const sanitizedContent = doc.body.innerText;
        createTab(result.filePath, sanitizedContent);
    }
}

function toggleTheme() { darkMode = !darkMode; document.body.classList.toggle('dark-mode'); localStorage.setItem('dark-mode', darkMode); }
function toggleFocusMode() { document.body.classList.toggle('focus-mode'); }
function updateWordCount() {
    const words = editor.innerText.trim().split(/\s+/).filter(w => w.length > 0);
    document.getElementById('word-count').textContent = `${words.length} words`;
}

// --- Floating Selection Menu Logic ---
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
        const tab = tabs.find(t => t.id === activeTabId);
        if (tab) {
            tab.content = editor.innerHTML;
            notebooks.forEach(nb => {
                const doc = nb.documents.find(d => d.id === tab.id);
                if (doc) doc.content = tab.content;
            });
            saveNotebooks();
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
        if (session.tabs && session.tabs.length > 0) { tabs = session.tabs; switchTab(session.activeTabId || tabs[0].id); }
    }
    renderFileList();
};

window.onbeforeunload = () => { localStorage.setItem('writ-session', JSON.stringify({ tabs, activeTabId })); };

document.addEventListener('keydown', (e) => {
    if (e.metaKey || e.ctrlKey) {
        if (e.key === 'p' || e.key === 'k') { e.preventDefault(); toggleCommandPalette(); }
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
