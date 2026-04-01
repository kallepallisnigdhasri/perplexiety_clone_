document.addEventListener('DOMContentLoaded', () => {
    const textarea = document.querySelector('.search-box textarea');
    const sendBtn = document.querySelector('.send-btn');
    const chatHistory = document.getElementById('chat-history');
    const body = document.body;

    const micBtn = document.getElementById('mic-btn');
    const uploadBtn = document.getElementById('upload-btn');
    const mediaUpload = document.getElementById('media-upload');
    const mediaPreviewContainer = document.getElementById('media-preview-container');
    const historyList = document.getElementById('history-list');
    const historyEmptyMsg = document.getElementById('history-empty-msg');

    let currentImageData = null;
    let recognition = null;
    let isListening = false;

    const CURRENT_CHAT_KEY = 'rubby_chat_history';
    const ALL_SESSIONS_KEY = 'rubby_all_chat_sessions';

    function saveCurrentChat() {
        const messages = [];
        document.querySelectorAll('.message').forEach(msg => {
            if (msg.classList.contains('loading-dots') || msg.classList.contains('system-msg')) return;
            const type = msg.classList.contains('user-message') ? 'user' : 'model';
            const text = msg.innerText;
            const img = msg.querySelector('img') ? msg.querySelector('img').src : null;
            messages.push({ type, text, img });
        });
        localStorage.setItem(CURRENT_CHAT_KEY, JSON.stringify(messages));
    }

    function archiveCurrentChat() {
        const currentData = localStorage.getItem(CURRENT_CHAT_KEY);
        if (currentData) {
            const messages = JSON.parse(currentData);
            if (messages.length > 0) {
                const sessionTitle = messages[0].text || "Attachment Only Session";
                const allSessions = JSON.parse(localStorage.getItem(ALL_SESSIONS_KEY) || '[]');
                allSessions.unshift({ title: sessionTitle, messages: messages, date: new Date().toISOString() });
                localStorage.setItem(ALL_SESSIONS_KEY, JSON.stringify(allSessions));
                localStorage.removeItem(CURRENT_CHAT_KEY);
            }
        }
    }

    function renderHistoryList() {
        const allSessions = JSON.parse(localStorage.getItem(ALL_SESSIONS_KEY) || '[]');
        historyList.innerHTML = '';
        if (allSessions.length === 0) {
            historyEmptyMsg.style.display = 'block';
            return;
        }
        historyEmptyMsg.style.display = 'none';
        allSessions.forEach((session, index) => {
            const item = document.createElement('div');
            item.classList.add('history-item');
            item.innerText = session.title;
            item.title = session.title;
            item.addEventListener('click', () => loadSession(index));
            historyList.appendChild(item);
        });
    }

    function loadSession(index) {
        saveCurrentChat();
        archiveCurrentChat();
        const allSessions = JSON.parse(localStorage.getItem(ALL_SESSIONS_KEY) || '[]');
        const session = allSessions[index];
        if (session) {
            allSessions.splice(index, 1);
            localStorage.setItem(ALL_SESSIONS_KEY, JSON.stringify(allSessions));
            chatHistory.innerHTML = '';
            body.classList.add('is-chatting');
            session.messages.forEach(msg => {
                if (msg.type === 'user') addUserMessage(msg.text, msg.img, false);
                else addMessage(msg.text, 'model', false);
            });
            renderHistoryList();
            saveCurrentChat();
        }
    }

    archiveCurrentChat(); 
    renderHistoryList();

    if ('SpeechRecognition' in window || 'webkitSpeechRecognition' in window) {
        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        recognition = new SpeechRecognition();
        recognition.continuous = true;
        recognition.interimResults = true;
        recognition.onresult = (event) => {
            let transientText = '';
            for (let i = event.resultIndex; i < event.results.length; ++i) {
                if (event.results[i].isFinal) textarea.value += event.results[i][0].transcript;
                else transientText += event.results[i][0].transcript;
            }
            textarea.style.height = 'auto';
            textarea.style.height = textarea.scrollHeight + 'px';
        };
        recognition.onend = () => { isListening = false; micBtn.classList.remove('listening'); };
    }

    if (micBtn) {
        micBtn.addEventListener('click', () => {
            if (!recognition) return alert("Speech recognition not supported.");
            if (isListening) recognition.stop();
            else { recognition.start(); isListening = true; micBtn.classList.add('listening'); }
        });
    }

    if (uploadBtn && mediaUpload) {
        uploadBtn.addEventListener('click', () => mediaUpload.click());
        mediaUpload.addEventListener('change', async (e) => {
            const file = e.target.files[0];
            if (!file) return;
            if (file.type.startsWith('image/')) {
                const reader = new FileReader();
                reader.onload = (event) => { currentImageData = event.target.result; showMediaPreview(currentImageData); };
                reader.readAsDataURL(file);
            } else if (file.type === 'application/pdf') {
                const reader = new FileReader();
                reader.onload = (event) => { indexPDF(event.target.result, file.name); };
                reader.readAsDataURL(file);
            }
        });
    }

    async function indexPDF(base64, filename) {
        const loadingId = addLoading("Processing PDF for RAG...");
        try {
            const response = await fetch('http://localhost:5000/api/upload-pdf', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ pdf_base64: base64 })
            });
            const data = await response.json();
            removeMessage(loadingId);
            if (data.message) addSystemMessage(`✅ Indexed: ${filename}. Ask Rubby anything!`);
            else addSystemMessage(`❌ PDF failed: ${data.error}`);
        } catch (error) {
            removeMessage(loadingId);
            addSystemMessage(`❌ Error connecting to RAG backend.`);
        }
    }

    function showMediaPreview(base64) {
        mediaPreviewContainer.innerHTML = `<div class="media-preview-item"><img src="${base64}"><button class="remove-media">&times;</button></div>`;
        mediaPreviewContainer.querySelector('.remove-media').addEventListener('click', () => {
            currentImageData = null; mediaPreviewContainer.innerHTML = ''; mediaUpload.value = '';
        });
    }

    if (textarea) {
        textarea.addEventListener('input', () => {
            textarea.style.height = 'auto';
            textarea.style.height = textarea.scrollHeight + 'px';
        });
        textarea.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
        });
    }

    async function sendMessage() {
        const messageText = textarea.value.trim();
        if (!messageText && !currentImageData) return;

        // Collect context (last 10 text messages) before clearing UI
        const history = getContextHistory(10);

        body.classList.add('is-chatting');
        textarea.value = ''; textarea.style.height = 'auto';

        addUserMessage(messageText, currentImageData);

        const imageToSend = currentImageData;
        currentImageData = null;
        mediaPreviewContainer.innerHTML = ''; mediaUpload.value = '';

        const loadingId = addLoading();

        try {
            const response = await fetch('http://localhost:5000/api/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                    message: messageText, 
                    image: imageToSend,
                    chat_history: history
                })
            });
            const data = await response.json();
            removeMessage(loadingId);
            if (data.response) addMessage(data.response, 'model');
            else addMessage("Oops! " + (data.error || "Unknown error"), 'model');
        } catch (error) {
            removeMessage(loadingId);
            addMessage("Backend connection error.", 'model');
        }
    }

    function getContextHistory(limit = 10) {
        const history = [];
        const msgElems = document.querySelectorAll('.message:not(.loading-dots):not(.system-msg)');
        // Take last N messages
        const relevantElems = Array.from(msgElems).slice(-limit);
        
        relevantElems.forEach(el => {
            const role = el.classList.contains('user-message') ? 'user' : 'model';
            // We only send text context for history to save tokens
            const text = el.innerText;
            if (text) {
                history.push({ role, parts: [{ text }] });
            }
        });
        return history;
    }

    function addUserMessage(text, imageBase64, save = true) {
        const msgDiv = document.createElement('div');
        msgDiv.classList.add('message', 'user-message');
        if (imageBase64) msgDiv.innerHTML = `<img src="${imageBase64}" style="max-width: 200px; border-radius: 8px; margin-bottom: 8px; display: block;">`;
        if (text) msgDiv.innerHTML += `<div>${text}</div>`;
        chatHistory.appendChild(msgDiv);
        chatHistory.scrollTop = chatHistory.scrollHeight;
        if (save) saveCurrentChat();
    }

    function addMessage(text, type, save = true) {
        const msgDiv = document.createElement('div');
        msgDiv.classList.add('message', `${type === 'ai' ? 'model' : type}-message`);
        msgDiv.innerText = text;
        chatHistory.appendChild(msgDiv);
        chatHistory.scrollTop = chatHistory.scrollHeight;
        if (save) saveCurrentChat();
        return msgDiv;
    }

    function addSystemMessage(text) {
        const msgDiv = document.createElement('div');
        msgDiv.classList.add('message', 'model-message', 'system-msg');
        msgDiv.style.fontStyle = 'italic'; msgDiv.style.opacity = '0.7';
        msgDiv.innerText = text;
        chatHistory.appendChild(msgDiv);
        chatHistory.scrollTop = chatHistory.scrollHeight;
    }

    function addLoading(text = null) {
        const loadDiv = document.createElement('div');
        const id = 'loading-' + Date.now();
        loadDiv.id = id;
        loadDiv.classList.add('message', 'model-message', 'loading-dots');
        let content = '<span></span><span></span><span></span>';
        if (text) content = `<div style="margin-bottom: 8px;">${text}</div>` + content;
        loadDiv.innerHTML = content;
        chatHistory.appendChild(loadDiv);
        chatHistory.scrollTop = chatHistory.scrollHeight;
        return id;
    }

    function removeMessage(id) { const el = document.getElementById(id); if (el) el.remove(); }

    if (sendBtn) sendBtn.addEventListener('click', sendMessage);

    const newThreadBtn = document.querySelector('.new-thread-btn');
    if (newThreadBtn) {
        newThreadBtn.addEventListener('click', () => {
            archiveCurrentChat();
            body.classList.remove('is-chatting');
            chatHistory.innerHTML = '';
            renderHistoryList();
            if (textarea) textarea.focus();
        });
    }
});
