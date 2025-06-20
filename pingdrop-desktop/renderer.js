// renderer.js

// This script handles all the frontend logic for the PingDrop application.

// --- Global Constants & Variables ---
const CHUNK_SIZE = 64 * 1024;
const MAX_PARALLEL_SENDER_UPLOADS = 4;
const FINAL_CANCEL_TIMEOUT = 3000;
const IGNORED_CHUNK_UI_UPDATE_THROTTLE_MS = 250;
const TOAST_VISIBILITY_DURATION_MS = 4000;

// --- DOM Element References ---
// We get all the elements from the HTML that we will need to interact with.
const fileInput = document.getElementById('fileInput');
const selectedFilesList = document.getElementById('selected-files-list');
const startSessionBtn = document.getElementById('startSessionBtn');
const shareIdContainer = document.getElementById('share-id-container');
const shareIdInput = document.getElementById('shareIdInput');
const messageBoxSend = document.getElementById('message-box-send');
const messageBoxReceive = document.getElementById('message-box-receive');

const senderIdInput = document.getElementById('senderIdInput');
const connectToPeerBtn = document.getElementById('connectToPeerBtn');
const receivedFilesList = document.getElementById('received-files-list');
const downloadAllContainer = document.getElementById('download-all-container');
const downloadAllBtn = document.getElementById('downloadAllBtn');
const downloadModeSelector = document.getElementById('download-mode-selector');

const senderActiveUploadsContainer = document.getElementById('sender-active-uploads-container');
const historyList = document.getElementById('history-list');

const openFileShareModalBtn = document.getElementById('openFileShareModalBtn');
const fileShareModal = document.getElementById('fileShareModal');
const closeFileShareModalBtn = document.getElementById('closeFileShareModalBtn');

const toastNotificationElement = document.getElementById('toast-notification');
const toastMessageElement = document.getElementById('toast-message');
let toastTimeoutId = null;

// --- Application State ---
let selectedFiles = [];
let peer = null;
let currentConnection = null;
let fileChunksCollector = {};

let senderFileRequestQueue = [];
let receiverDownloadQueue = [];
let currentDownloadingFileReceiver = null;
let downloadHistory = [];

// --- PeerJS Configuration ---
const peerJsConfig = {
    debug: 0,
    config: {
        'iceServers': [{
            urls: 'stun:stun.l.google.com:19302'
        }, {
            urls: 'stun:stun1.l.google.com:19302'
        }]
    }
};

// --- Download History Management ---
let userDataPath = '';
let historyFilePath = '';

async function initializeHistory() {
    try {
        userDataPath = await window.electronAPI.getUserDataPath();
        historyFilePath = window.electronAPI.path.join(userDataPath, 'download-history.json');
        loadDownloadHistory();
    } catch (error) {
        console.error("Could not initialize history:", error);
    }
}

function loadDownloadHistory() {
    try {
        if (window.electronAPI.fs.existsSync(historyFilePath)) {
            const historyData = window.electronAPI.fs.readFileSync(historyFilePath, 'utf8');
            downloadHistory = JSON.parse(historyData);
        } else {
            downloadHistory = [];
        }
    } catch (error) {
        console.error("Failed to load download history:", error);
        downloadHistory = [];
    }
    renderDownloadHistory();
}

function saveDownloadHistory() {
    try {
        const historyData = JSON.stringify(downloadHistory, null, 2);
        window.electronAPI.fs.writeFileSync(historyFilePath, historyData, 'utf8');
    } catch (error) {
        console.error("Failed to save download history:", error);
    }
}

function addToHistory(fileInfo) {
    const now = new Date();
    const historyEntry = {
        ...fileInfo,
        timestamp: now.toISOString(),
    };
    downloadHistory.unshift(historyEntry);
    if (downloadHistory.length > 100) {
        downloadHistory.pop();
    }
    saveDownloadHistory();
    renderDownloadHistory();
}

function renderDownloadHistory() {
    if (!historyList) return;
    historyList.innerHTML = '';
    if (downloadHistory.length === 0) {
        historyList.innerHTML = '<p class="text-gray-500 text-center col-span-full">No downloaded files yet.</p>';
        return;
    }
    downloadHistory.forEach(item => {
        const itemEl = document.createElement('div');
        itemEl.className = 'history-item bg-gray-50 p-3 rounded-lg shadow-sm flex justify-between items-center';
        itemEl.innerHTML = `
            <div class="flex-grow overflow-hidden">
                <p class="text-sm font-medium text-gray-800 truncate" title="${escapeHTML(item.fileName)}">${escapeHTML(item.fileName)}</p>
                <p class="text-xs text-gray-500">${formatFileSize(item.size)} - ${new Date(item.timestamp).toLocaleString()}</p>
            </div>
            <div class="flex-shrink-0 ml-4">
                <button class="open-location-btn text-blue-600 hover:text-blue-800 p-2" title="Show in Folder"><i class="fas fa-folder-open"></i></button>
                <button class="open-file-btn text-green-600 hover:text-green-800 p-2" title="Open File"><i class="fas fa-play-circle"></i></button>
            </div>
        `;
        itemEl.querySelector('.open-location-btn').addEventListener('click', () => {
            window.electronAPI.send('open-file-location', item.path);
        });
        itemEl.querySelector('.open-file-btn').addEventListener('click', () => {
            window.electronAPI.send('open-file', item.path);
        });
        historyList.appendChild(itemEl);
    });
}


// --- Utility Functions ---

function generateShortId(length = 6) {
    const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let result = '';
    const charactersLength = characters.length;
    for (let i = 0; i < length; i++) {
        result += characters.charAt(Math.floor(Math.random() * charactersLength));
    }
    return result;
}

function formatFileSize(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function escapeHTML(str) {
    if (typeof str !== 'string') return '';
    return str.replace(/[&<>"']/g, match => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
    })[match]);
}

function showMessage(tab, text, type = 'info') {
    const box = tab === 'send' ? messageBoxSend : messageBoxReceive;
    if (!box) return;
    box.textContent = text;
    box.className = 'mt-4 p-3 rounded-md text-sm';
    if (type === 'success') box.classList.add('bg-green-100', 'text-green-700');
    else if (type === 'error') box.classList.add('bg-red-100', 'text-red-700');
    else box.classList.add('bg-blue-100', 'text-blue-700');
    box.style.display = 'block';
    setTimeout(() => {
        if (box) box.style.display = 'none';
    }, 7000);
}


function showToastNotification(message, type = 'success') {
    if (!toastNotificationElement || !toastMessageElement) return;
    toastMessageElement.textContent = message;
    toastNotificationElement.className = 'show';
    if (type === 'error') {
        toastNotificationElement.classList.add('error');
    } else if (type === 'info') {
        toastNotificationElement.classList.add('info');
    }

    if (toastTimeoutId) clearTimeout(toastTimeoutId);
    toastTimeoutId = setTimeout(() => {
        toastNotificationElement.classList.remove('show');
    }, TOAST_VISIBILITY_DURATION_MS);
}

// --- UI Interaction & Event Handlers ---

// This function handles switching between tabs in the modal.
window.openTab = function(event, tabName) {
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active-content'));
    document.querySelectorAll('.tab-link').forEach(l => l.classList.remove('active', 'text-blue-600', 'border-b-2', 'border-blue-600'));
    
    document.getElementById(tabName)?.classList.add('active-content');
    event.currentTarget.classList.add('active', 'text-blue-600', 'border-b-2', 'border-blue-600');

    if (tabName === 'history-tab') renderDownloadHistory();
}

function setupEventListeners() {
    // Modal controls
    if (openFileShareModalBtn) {
        openFileShareModalBtn.addEventListener('click', () => {
            fileShareModal.classList.remove('hidden');
            fileShareModal.classList.add('flex');
            // Programmatically click the first tab to ensure it's active
             document.querySelector('.tab-link').click();
        });
    }
    if (closeFileShareModalBtn) {
       closeFileShareModalBtn.addEventListener('click', () => {
            fileShareModal.classList.add('hidden');
            fileShareModal.classList.remove('flex');
        });
    }
    window.addEventListener('keydown', (event) => {
        if (event.key === 'Escape' && !fileShareModal.classList.contains('hidden')) {
            closeFileShareModalBtn.click();
        }
    });
    fileShareModal.addEventListener('click', (event) => {
        if (event.target === fileShareModal) closeFileShareModalBtn.click();
    });

    if (fileInput) fileInput.addEventListener('change', handleFileSelect);

    const fileDropZone = document.querySelector('.file-drop-zone');
    if (fileDropZone) {
        fileDropZone.addEventListener('dragover', e => { e.preventDefault(); fileDropZone.classList.add('dragover'); });
        fileDropZone.addEventListener('dragleave', () => fileDropZone.classList.remove('dragover'));
        fileDropZone.addEventListener('drop', e => {
            e.preventDefault();
            fileDropZone.classList.remove('dragover');
            if (e.dataTransfer.files.length > 0) handleFileSelect({ target: { files: e.dataTransfer.files } });
        });
    }

    if (startSessionBtn) startSessionBtn.addEventListener('click', startSharingSession);
    if (connectToPeerBtn) connectToPeerBtn.addEventListener('click', connectToPeer);
    if (downloadAllBtn) downloadAllBtn.addEventListener('click', handleDownloadAll);

    // Mobile Menu
    const mobileMenuButton = document.getElementById('mobileMenuButton');
    const mobileMenu = document.getElementById('mobileMenu');
    if (mobileMenuButton && mobileMenu) {
        mobileMenuButton.addEventListener('click', () => mobileMenu.classList.toggle('hidden'));
    }
}


function handleFileSelect(event) {
    const newFiles = Array.from(event.target.files);
    newFiles.forEach(newFile => {
        if (!selectedFiles.some(f => f.name === newFile.name && f.size === newFile.size)) {
            selectedFiles.push(newFile);
        } else {
            showMessage('send', `'${escapeHTML(newFile.name)}' is already selected.`, 'info');
        }
    });
    renderSelectedFiles();
    if (selectedFiles.length > 0) startSessionBtn.style.display = 'inline-flex';
    else startSessionBtn.style.display = 'none';
}

function renderSelectedFiles() {
    selectedFilesList.innerHTML = '';
    selectedFiles.forEach((file, index) => {
        const item = document.createElement('div');
        item.className = 'file-item flex justify-between items-center p-3 bg-gray-100 rounded-lg shadow-sm';
        item.innerHTML = `
            <div class="flex items-center overflow-hidden mr-2">
                <i class="fas fa-file-alt text-blue-500 mr-3"></i>
                <span class="text-sm text-gray-700 truncate" title="${escapeHTML(file.name)}">${escapeHTML(file.name)}</span>
                <span class="text-xs text-gray-500 ml-2 whitespace-nowrap">(${formatFileSize(file.size)})</span>
            </div>
            <button data-index="${index}" class="remove-file-btn text-red-500 hover:text-red-700 p-1 rounded-full hover:bg-red-100"><i class="fas fa-times-circle text-lg"></i></button>`;
        selectedFilesList.appendChild(item);
    });
    // Add event listeners for the new remove buttons
    document.querySelectorAll('.remove-file-btn').forEach(btn => {
        btn.addEventListener('click', (e) => removeFile(parseInt(e.currentTarget.dataset.index)));
    });
}

function removeFile(index) {
    selectedFiles.splice(index, 1);
    renderSelectedFiles();
    if (selectedFiles.length === 0) startSessionBtn.style.display = 'none';
}


// --- PeerJS Core Logic ---

function startSharingSession() {
    if (selectedFiles.length === 0) {
        showMessage('send', "Please select files to share first.", 'error');
        return;
    }
    if (peer && !peer.destroyed) peer.destroy();
    
    startSessionBtn.disabled = true;
    startSessionBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Starting...';
    
    peer = new Peer(generateShortId(6), peerJsConfig);
    
    peer.on('open', id => {
        showMessage('send', `Sharing session started. Your Share ID: ${id}`, 'success');
        shareIdInput.value = id;
        shareIdContainer.style.display = 'block';
        startSessionBtn.disabled = false;
        startSessionBtn.innerHTML = '<i class="fas fa-sync-alt"></i> Restart Session';
        setupSenderPeerEventHandlers(peer);
    });
    
    peer.on('error', err => {
        console.error("[SENDER] PeerJS Error:", err);
        showMessage('send', `PeerJS Error: ${err.type}`, 'error');
        startSessionBtn.disabled = false;
        startSessionBtn.innerHTML = '<i class="fas fa-play-circle"></i> Start Sharing Session';
        if (peer && !peer.destroyed) peer.destroy();
    });
}

function connectToPeer() {
    const remoteId = senderIdInput.value.trim();
    if (!remoteId) {
        showMessage('receive', "Please enter the Sender's Share ID.", 'error');
        return;
    }
    if (peer) peer.destroy();
    
    connectToPeerBtn.disabled = true;
    showMessage('receive', `Initializing connection to ${remoteId}...`, 'info');

    peer = new Peer(undefined, peerJsConfig);
    
    peer.on('open', () => {
        currentConnection = peer.connect(remoteId, { reliable: true });
        setupReceiverConnectionHandlers(currentConnection);
    });
    
    peer.on('error', err => {
        console.error("[RECEIVER] PeerJS Error:", err);
        showMessage('receive', `PeerJS Error: ${err.type}`, 'error');
        resetReceiverUI();
    });
}

function setupSenderPeerEventHandlers(p) {
    p.on('connection', conn => {
        currentConnection = conn;
        conn.on('open', () => {
            showMessage('send', `Peer ${conn.peer} connected. Sending file list.`, 'success');
            sendFileList(conn);
        });
        conn.on('data', data => handleSenderData(conn, data));
        conn.on('close', () => showMessage('send', `Peer ${conn.peer} disconnected.`, 'info'));
    });
}

function setupReceiverConnectionHandlers(conn) {
    conn.on('open', () => {
        showMessage('receive', `Connected to sender ${conn.peer}! Waiting for file list...`, 'success');
        connectToPeerBtn.innerHTML = '<i class="fas fa-check-circle"></i> Connected';
    });
    conn.on('data', data => handleReceiverData(data));
    conn.on('close', () => {
        showMessage('receive', 'Connection to sender closed.', 'info');
        resetReceiverUI();
    });
    conn.on('error', err => {
        console.error("[RECEIVER] DataConnection error:", err);
        showMessage('receive', `Connection error: ${err.message}`, 'error');
        resetReceiverUI();
    });
}

// --- Data Handling ---

function handleSenderData(conn, data) {
    if (data.type === 'request-file') {
        const fileToShare = selectedFiles.find(f => f.name === data.fileName);
        if (fileToShare) {
            sendFileInChunks(conn, fileToShare);
        } else {
            conn.send({ type: 'error', message: `File '${data.fileName}' not found.` });
        }
    }
}

function handleReceiverData(data) {
    if (data.type === 'file-list') {
        renderReceivedFiles(data.files);
    } else if (data.type === 'file-chunk') {
        processFileChunk(data);
    } else if (data.type === 'error') {
        showMessage('receive', `Error from sender: ${escapeHTML(data.message)}`, 'error');
    }
}

// --- File Transfer Logic ---

function sendFileInChunks(conn, file) {
    const reader = new FileReader();
    let offset = 0;
    const totalChunks = Math.ceil(file.size / CHUNK_SIZE);
    let chunkIndex = 0;

    reader.onload = (event) => {
        if (!conn.open) return;
        conn.send({
            type: 'file-chunk',
            name: file.name,
            chunk: event.target.result,
            chunkIndex: chunkIndex++,
            totalChunks: totalChunks,
            isLast: (offset + event.target.result.byteLength) >= file.size,
            fileType: file.type,
            fileSize: file.size
        });
        offset += event.target.result.byteLength;
        if (offset < file.size) readNextChunk();
    };
    const readNextChunk = () => {
        const slice = file.slice(offset, offset + CHUNK_SIZE);
        reader.readAsArrayBuffer(slice);
    };
    readNextChunk();
}

function processFileChunk(data) {
    const { name, chunk, chunkIndex, isLast, fileType, fileSize } = data;
    if (!fileChunksCollector[name]) {
        fileChunksCollector[name] = { chunks: [], receivedSize: 0, totalSize: fileSize, fileType };
    }

    const fileData = fileChunksCollector[name];
    fileData.chunks[chunkIndex] = chunk;
    fileData.receivedSize += chunk.byteLength;

    const progress = Math.round((fileData.receivedSize / fileData.totalSize) * 100);
    updateDownloadProgress(name, progress, fileData.receivedSize);

    if (isLast && fileData.receivedSize >= fileData.totalSize) {
        const completeFileBlob = new Blob(fileData.chunks, { type: fileData.fileType });
        triggerDownload(completeFileBlob, name);
        delete fileChunksCollector[name];
    }
}

function triggerDownload(blob, fileName) {
    const reader = new FileReader();
    reader.onload = function() {
        const buffer = new Uint8Array(reader.result);
        window.electronAPI.send('download-file', { fileName, data: buffer });
    };
    reader.readAsArrayBuffer(blob);
}

// --- UI Update Functions ---

function renderReceivedFiles(files) {
    receivedFilesList.innerHTML = '';
    if (files.length > 0) {
        files.forEach(file => {
            const item = document.createElement('div');
            item.className = 'file-item p-3 bg-gray-100 rounded-lg shadow-sm';
            item.dataset.filename = escapeHTML(file.name);
            item.innerHTML = `
                <div class="flex justify-between items-center">
                    <div class="flex items-center overflow-hidden mr-2">
                        <i class="fas fa-file-alt text-blue-500 mr-3"></i>
                        <span class="text-sm text-gray-700 truncate" title="${escapeHTML(file.name)}">${escapeHTML(file.name)}</span>
                        <span class="text-xs text-gray-500 ml-2 whitespace-nowrap">(${formatFileSize(file.size)})</span>
                    </div>
                    <button class="download-btn btn bg-green-500 hover:bg-green-600 text-white font-medium py-1 px-3 rounded-lg shadow text-xs" data-filename="${escapeHTML(file.name)}">
                        <i class="fas fa-download"></i> Download
                    </button>
                </div>
                <div class="file-progress-container mt-2" style="display:none;">
                    <progress class="file-progress-bar w-full h-2 rounded-lg" value="0" max="100"></progress>
                    <p class="file-status-text text-xs text-gray-500 mt-1"></p>
                </div>`;
            item.querySelector('.download-btn').addEventListener('click', function() {
                requestFileFromServer(this.dataset.filename);
                this.disabled = true;
                this.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Requested';
            });
            receivedFilesList.appendChild(item);
        });
        if (downloadAllContainer) downloadAllContainer.style.display = 'block';
    }
}

function updateDownloadProgress(fileName, progress, receivedSize = 0) {
    const fileItem = receivedFilesList.querySelector(`.file-item[data-filename="${escapeHTML(fileName)}"]`);
    if (fileItem) {
        const progressContainer = fileItem.querySelector('.file-progress-container');
        const progressBar = fileItem.querySelector('.file-progress-bar');
        const statusText = fileItem.querySelector('.file-status-text');

        progressContainer.style.display = 'block';
        progressBar.value = progress;
        statusText.textContent = `${progress}% downloaded (${formatFileSize(receivedSize)})`;

        if (progress === 100) statusText.textContent = 'Download complete! Saving...';
    }
}

function requestFileFromServer(fileName) {
    if (currentConnection?.open) {
        currentConnection.send({ type: 'request-file', fileName });
    } else {
        showMessage('receive', 'Not connected to sender.', 'error');
    }
}

function handleDownloadAll() {
    document.querySelectorAll('.download-btn:not(:disabled)').forEach(button => button.click());
}

function resetReceiverUI() {
    connectToPeerBtn.disabled = false;
    connectToPeerBtn.innerHTML = '<i class="fas fa-plug"></i> Connect to Sender';
    receivedFilesList.innerHTML = '';
    downloadAllContainer.style.display = 'none';
    if (peer) peer.destroy();
    currentConnection = null;
}

// --- IPC Listeners from Main Process ---
window.electronAPI.on('download-complete', (result) => {
    if (result.success) {
        showToastNotification(`'${result.fileName}' saved successfully!`, 'success');
        addToHistory({ fileName: result.fileName, path: result.path, size: result.size });
    } else {
        showToastNotification(`Failed to save '${result.fileName}'.`, 'error');
    }
     const fileItem = receivedFilesList.querySelector(`.file-item[data-filename="${escapeHTML(result.fileName)}"]`);
     if(fileItem) {
         const downloadBtn = fileItem.querySelector('.download-btn');
         const statusText = fileItem.querySelector('.file-status-text');
         downloadBtn.innerHTML = '<i class="fas fa-check-circle"></i> Done';
         downloadBtn.classList.replace('bg-green-500', 'bg-gray-400');
         statusText.textContent = 'Successfully saved to disk.';
     }
});

// --- App Initialization ---
document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('currentYear').textContent = new Date().getFullYear();
    setupEventListeners();
    initializeHistory();
});

// --- Expose functions to be called from inline HTML ---
window.copyShareId = function() {
    if (!shareIdInput?.value) return;
    navigator.clipboard.writeText(shareId_input.value)
        .then(() => showMessage('send', 'Share ID copied!', 'success'))
        .catch(() => showMessage('send', 'Failed to copy ID.', 'error'));
};
