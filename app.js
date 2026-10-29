/**
 * BoardCast — Single Page Application (SPA)
 * P2P Real-Time Blackboard Broadcaster for Students
 * Uses PeerJS (WebRTC), Screen Wake Lock API, Pinch-to-zoom & Canvas filters
 */

(function () {
  'use strict';

  // ==========================================================================
  // APP STATE
  // ==========================================================================
  const state = {
    mode: 'home', // 'home' | 'host' | 'viewer'
    roomCode: '',
    peer: null,
    peerId: '',

    // Host specific
    localStream: null,
    hostViewers: new Map(), // peerId -> { call, dataConn }
    availableCameras: [],
    selectedCameraId: '',
    wakeLock: null,
    isAmoledActive: false,
    hardwareZoom: { supported: false, min: 1, max: 5, step: 0.1, current: 1 },
    hasTorch: false,
    isTorchOn: false,

    // Viewer specific
    activeCall: null,
    activeDataConn: null,
    remoteStream: null,
    isFrozen: false,
    currentFilter: 'normal',
    gallery: [], // { id, dataUrl, timestamp, timeFormatted }
    zoom: {
      scale: 1,
      minScale: 1,
      maxScale: 10,
      x: 0,
      y: 0,
      isPanning: false,
      startX: 0,
      startY: 0,
      initialDistance: 0,
      initialScale: 1,
      lastTapTime: 0
    }
  };

  // PeerJS STUN servers configuration for ultra-reliable P2P discovery
  const PEER_CONFIG = {
    debug: 1,
    config: {
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:stun2.l.google.com:19302' },
        { urls: 'stun:stun3.l.google.com:19302' },
        { urls: 'stun:stun4.l.google.com:19302' }
      ]
    }
  };

  // ==========================================================================
  // DOM ELEMENTS
  // ==========================================================================
  const DOM = {
    // Top bar & Nav
    brandLogoBtn: document.getElementById('brandLogoBtn'),
    headerLiveBadge: document.getElementById('headerLiveBadge'),
    headerLiveText: document.getElementById('headerLiveText'),
    headerGalleryBtn: document.getElementById('headerGalleryBtn'),
    galleryCountBadge: document.getElementById('galleryCountBadge'),
    helpModalBtn: document.getElementById('helpModalBtn'),
    leaveRoomBtn: document.getElementById('leaveRoomBtn'),

    // Views
    viewHome: document.getElementById('viewHome'),
    viewHost: document.getElementById('viewHost'),
    viewViewer: document.getElementById('viewViewer'),

    // Home view elements
    startHostBtn: document.getElementById('startHostBtn'),
    joinViewerBtn: document.getElementById('joinViewerBtn'),
    roomCodeInput: document.getElementById('roomCodeInput'),

    // Host view elements
    hostRoomCodeDisplay: document.getElementById('hostRoomCodeDisplay'),
    hostCopyCodeBtn: document.getElementById('hostCopyCodeBtn'),
    hostViewersCount: document.getElementById('hostViewersCount'),
    hostShowQrBtn: document.getElementById('hostShowQrBtn'),
    wakeLockStatus: document.getElementById('wakeLockStatus'),
    hostVideoPreview: document.getElementById('hostVideoPreview'),
    hostSnapshotCanvas: document.getElementById('hostSnapshotCanvas'),
    hostStreamResolution: document.getElementById('hostStreamResolution'),
    hostTorchBtn: document.getElementById('hostTorchBtn'),
    hostTrackState: document.getElementById('hostTrackState'),
    hostCameraSelect: document.getElementById('hostCameraSelect'),
    hostRefreshCamerasBtn: document.getElementById('hostRefreshCamerasBtn'),
    hostZoomContainer: document.getElementById('hostZoomContainer'),
    hostZoomSlider: document.getElementById('hostZoomSlider'),
    hostZoomValue: document.getElementById('hostZoomValue'),
    hostZoomMaxLabel: document.getElementById('hostZoomMaxLabel'),
    activateAmoledBtn: document.getElementById('activateAmoledBtn'),

    // AMOLED overlay
    amoledOverlay: document.getElementById('amoledOverlay'),
    amoledViewersCount: document.getElementById('amoledViewersCount'),

    // Viewer view elements
    viewerRoomCodeDisplay: document.getElementById('viewerRoomCodeDisplay'),
    viewerConnectionState: document.getElementById('viewerConnectionState'),
    viewerStateText: document.getElementById('viewerStateText'),
    filterButtons: document.querySelectorAll('.filter-btn'),
    videoViewport: document.getElementById('videoViewport'),
    videoTransformWrapper: document.getElementById('videoTransformWrapper'),
    viewerVideo: document.getElementById('viewerVideo'),
    freezeCanvas: document.getElementById('freezeCanvas'),
    viewerLoadingOverlay: document.getElementById('viewerLoadingOverlay'),
    freezeBadge: document.getElementById('freezeBadge'),
    floatingZoomPill: document.getElementById('floatingZoomPill'),
    zoomLevelDisplay: document.getElementById('zoomLevelDisplay'),
    resetZoomBtn: document.getElementById('resetZoomBtn'),
    zoomHintOverlay: document.getElementById('zoomHintOverlay'),
    freezeToggleBtn: document.getElementById('freezeToggleBtn'),
    freezeIconPause: document.getElementById('freezeIconPause'),
    freezeIconPlay: document.getElementById('freezeIconPlay'),
    freezeBtnText: document.getElementById('freezeBtnText'),
    takeSnapshotBtn: document.getElementById('takeSnapshotBtn'),
    openGalleryDrawerBtn: document.getElementById('openGalleryDrawerBtn'),
    viewerGalleryBadge: document.getElementById('viewerGalleryBadge'),
    toggleFullscreenBtn: document.getElementById('toggleFullscreenBtn'),

    // Modals
    qrModal: document.getElementById('qrModal'),
    qrcodeBox: document.getElementById('qrcodeBox'),
    qrModalCodeText: document.getElementById('qrModalCodeText'),
    copyShareLinkBtn: document.getElementById('copyShareLinkBtn'),
    nativeShareBtn: document.getElementById('nativeShareBtn'),
    closeQrModalBtn: document.getElementById('closeQrModalBtn'),

    galleryDrawer: document.getElementById('galleryDrawer'),
    galleryGrid: document.getElementById('galleryGrid'),
    galleryEmptyState: document.getElementById('galleryEmptyState'),
    galleryDrawerCount: document.getElementById('galleryDrawerCount'),
    downloadAllPhotosBtn: document.getElementById('downloadAllPhotosBtn'),
    closeGalleryDrawerBtn: document.getElementById('closeGalleryDrawerBtn'),

    photoPreviewModal: document.getElementById('photoPreviewModal'),
    photoPreviewImg: document.getElementById('photoPreviewImg'),
    photoPreviewTime: document.getElementById('photoPreviewTime'),
    photoPreviewDownloadLink: document.getElementById('photoPreviewDownloadLink'),
    closePhotoPreviewBtn: document.getElementById('closePhotoPreviewBtn'),

    helpModal: document.getElementById('helpModal'),
    closeHelpModalBtn: document.getElementById('closeHelpModalBtn'),

    toastContainer: document.getElementById('toastContainer')
  };

  // QR Code instance holder
  let qrcodeInstance = null;

  // ==========================================================================
  // INITIALIZATION & URL HANDLING
  // ==========================================================================
  function initApp() {
    setupEventListeners();
    loadPersistedGallery();

    // Check if room parameter is passed in URL (?room=4829)
    const urlParams = new URLSearchParams(window.location.search);
    const roomParam = urlParams.get('room');
    if (roomParam) {
      const cleanRoom = roomParam.trim().toUpperCase();
      DOM.roomCodeInput.value = cleanRoom;
      switchView('viewer');
      joinRoomAsViewer(cleanRoom);
    } else {
      switchView('home');
    }
  }

  // ==========================================================================
  // NAVIGATION & VIEW SWITCHER
  // ==========================================================================
  function switchView(viewName) {
    state.mode = viewName;

    // Toggle main sections
    DOM.viewHome.classList.toggle('hidden', viewName !== 'home');
    DOM.viewHost.classList.toggle('hidden', viewName !== 'host');
    DOM.viewViewer.classList.toggle('hidden', viewName !== 'viewer');

    // Header buttons visibility
    const isInRoom = viewName === 'host' || viewName === 'viewer';
    DOM.leaveRoomBtn.classList.toggle('hidden', !isInRoom);
    DOM.headerLiveBadge.classList.toggle('hidden', !isInRoom);
    DOM.headerGalleryBtn.classList.toggle('hidden', viewName !== 'viewer');

    if (viewName === 'host') {
      DOM.headerLiveText.textContent = 'ТРАНСЛЯЦИЯ';
      DOM.headerLiveBadge.className = 'flex items-center gap-2 px-3 py-1 rounded-full bg-red-500/10 border border-red-500/30 text-red-400 text-xs font-semibold animate-pulse';
    } else if (viewName === 'viewer') {
      DOM.headerLiveText.textContent = 'ПРЯМОЙ ЭФИР';
      DOM.headerLiveBadge.className = 'flex items-center gap-2 px-3 py-1 rounded-full bg-cyan-500/10 border border-cyan-500/30 text-cyan-400 text-xs font-semibold';
    }

    // Scroll to top
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  // ==========================================================================
  // EVENT LISTENERS SETUP
  // ==========================================================================
  function setupEventListeners() {
    // Logo & Header
    DOM.brandLogoBtn.addEventListener('click', (e) => {
      e.preventDefault();
      if (state.mode !== 'home') {
        confirmLeaveRoom();
      }
    });

    DOM.leaveRoomBtn.addEventListener('click', confirmLeaveRoom);

    // Home view
    DOM.startHostBtn.addEventListener('click', startBroadcastingAsHost);
    DOM.joinViewerBtn.addEventListener('click', () => {
      const code = DOM.roomCodeInput.value.trim().toUpperCase();
      if (!code) {
        showToast('Пожалуйста, введи 4-значный код комнаты', 'warning');
        DOM.roomCodeInput.focus();
        return;
      }
      switchView('viewer');
      joinRoomAsViewer(code);
    });

    DOM.roomCodeInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        DOM.joinViewerBtn.click();
      }
    });

    // Host view controls
    DOM.hostCopyCodeBtn.addEventListener('click', copyRoomLinkToClipboard);
    DOM.hostShowQrBtn.addEventListener('click', openQrModal);
    DOM.hostRefreshCamerasBtn.addEventListener('click', enumerateAndPopulateCameras);
    DOM.hostCameraSelect.addEventListener('change', onHostCameraSelectChanged);
    DOM.hostZoomSlider.addEventListener('input', onHostHardwareZoomChange);
    DOM.hostTorchBtn.addEventListener('click', toggleHostTorch);
    DOM.activateAmoledBtn.addEventListener('click', enterAmoledMode);

    // AMOLED overlay interaction (double-tap to exit)
    DOM.amoledOverlay.addEventListener('click', handleAmoledClick);

    // Viewer view controls
    DOM.freezeToggleBtn.addEventListener('click', toggleFreezeFrame);
    DOM.takeSnapshotBtn.addEventListener('click', requestOrTakeSnapshot);
    DOM.openGalleryDrawerBtn.addEventListener('click', openGalleryDrawer);
    DOM.headerGalleryBtn.addEventListener('click', openGalleryDrawer);
    DOM.resetZoomBtn.addEventListener('click', resetViewerZoom);
    DOM.toggleFullscreenBtn.addEventListener('click', toggleFullscreen);

    // Filter preset buttons
    DOM.filterButtons.forEach(btn => {
      btn.addEventListener('click', () => {
        const filterType = btn.getAttribute('data-filter');
        applyReadabilityFilter(filterType);
      });
    });

    // Modals close buttons
    DOM.closeQrModalBtn.addEventListener('click', closeQrModal);
    DOM.closeGalleryDrawerBtn.addEventListener('click', closeGalleryDrawer);
    DOM.closePhotoPreviewBtn.addEventListener('click', closePhotoPreview);
    DOM.closeHelpModalBtn.addEventListener('click', () => DOM.helpModal.classList.add('hidden'));
    DOM.helpModalBtn.addEventListener('click', () => DOM.helpModal.classList.remove('hidden'));

    // Share buttons inside QR modal
    DOM.copyShareLinkBtn.addEventListener('click', copyRoomLinkToClipboard);
    DOM.nativeShareBtn.addEventListener('click', shareRoomLinkNative);
    DOM.downloadAllPhotosBtn.addEventListener('click', downloadAllGalleryPhotos);

    // Setup interactive Zoom & Pan on video player
    setupViewerPinchAndPan();

    // Re-acquire WakeLock if browser was minimized and reopened
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && state.mode === 'host' && state.localStream) {
        requestScreenWakeLock();
      }
    });
  }

  // ==========================================================================
  // MODE 1: HOST LOGIC («Я ТРАНСЛИРУЮ ДОСКУ»)
  // ==========================================================================
  async function startBroadcastingAsHost() {
    showToast('Запрос доступа к камере смартфона...', 'info');

    // 1. Generate short 4-digit room code
    state.roomCode = generate4DigitCode();
    state.peerId = `boardcast-${state.roomCode}`;
    DOM.hostRoomCodeDisplay.textContent = state.roomCode;
    DOM.qrModalCodeText.textContent = state.roomCode;

    // 2. Request Camera stream with preferred environment / high-res
    try {
      await initializeHostCamera();
    } catch (err) {
      console.error('Camera initialization error:', err);
      showToast(`Ошибка камеры: ${err.message || 'Не удалось запустить видео'}`, 'error');
      return;
    }

    // 3. Switch to host view
    switchView('host');

    // 4. Request Screen Wake Lock so phone doesn't sleep
    requestScreenWakeLock();

    // 5. Initialize PeerJS as Host
    initializeHostPeer();
  }

  function generate4DigitCode() {
    // Generate readable 4 digits (e.g. 1000 - 9999)
    return Math.floor(1000 + Math.random() * 9000).toString();
  }

  async function initializeHostCamera(deviceId = null) {
    // Stop existing stream if switching camera
    if (state.localStream) {
      state.localStream.getTracks().forEach(track => track.stop());
      state.localStream = null;
    }

    const videoConstraints = {
      facingMode: deviceId ? undefined : { ideal: 'environment' },
      deviceId: deviceId ? { exact: deviceId } : undefined,
      width: { ideal: 1920, max: 3840 },
      height: { ideal: 1080, max: 2160 },
      frameRate: { ideal: 30, max: 60 }
    };

    const stream = await navigator.mediaDevices.getUserMedia({
      video: videoConstraints,
      audio: false
    });

    state.localStream = stream;
    DOM.hostVideoPreview.srcObject = stream;

    // Inspect active track capabilities (Resolution, Zoom, Torch)
    const track = stream.getVideoTracks()[0];
    if (track) {
      const settings = track.getSettings();
      DOM.hostStreamResolution.textContent = `${settings.width || 1080}p • ${Math.round(settings.frameRate || 30)}fps`;

      // Check capabilities (Hardware Zoom & Torch)
      if (typeof track.getCapabilities === 'function') {
        const capabilities = track.getCapabilities();

        // Hardware Zoom
        if (capabilities.zoom) {
          state.hardwareZoom.supported = true;
          state.hardwareZoom.min = capabilities.zoom.min || 1;
          state.hardwareZoom.max = capabilities.zoom.max || 5;
          state.hardwareZoom.step = capabilities.zoom.step || 0.1;
          state.hardwareZoom.current = settings.zoom || 1;

          DOM.hostZoomSlider.min = state.hardwareZoom.min;
          DOM.hostZoomSlider.max = state.hardwareZoom.max;
          DOM.hostZoomSlider.step = state.hardwareZoom.step;
          DOM.hostZoomSlider.value = state.hardwareZoom.current;
          DOM.hostZoomValue.textContent = `${state.hardwareZoom.current.toFixed(1)}x`;
          DOM.hostZoomMaxLabel.textContent = `${state.hardwareZoom.max}x`;
          DOM.hostZoomContainer.classList.remove('hidden');
        } else {
          state.hardwareZoom.supported = false;
          DOM.hostZoomContainer.classList.add('hidden');
        }

        // Torch / Flashlight
        if (capabilities.torch) {
          state.hasTorch = true;
          DOM.hostTorchBtn.classList.remove('hidden');
        } else {
          state.hasTorch = false;
          DOM.hostTorchBtn.classList.add('hidden');
        }
      }
    }

    // Populate camera selection list
    await enumerateAndPopulateCameras();

    // If active viewers already exist, update their video tracks seamlessly
    updateActiveViewersTracks();
  }

  async function enumerateAndPopulateCameras() {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const videoDevices = devices.filter(d => d.kind === 'videoinput');
      state.availableCameras = videoDevices;

      DOM.hostCameraSelect.innerHTML = '';

      if (videoDevices.length === 0) {
        DOM.hostCameraSelect.innerHTML = '<option value="">Камеры не найдены</option>';
        return;
      }

      // Find currently active device ID from stream
      const currentTrack = state.localStream?.getVideoTracks()[0];
      const activeDeviceId = currentTrack?.getSettings()?.deviceId;

      videoDevices.forEach((device, index) => {
        const option = document.createElement('option');
        option.value = device.deviceId;

        let label = device.label || `Камера ${index + 1}`;
        // Add helpful tags for students (telephoto, wide, rear)
        const lowerLabel = label.toLowerCase();
        if (lowerLabel.includes('back') || lowerLabel.includes('rear') || lowerLabel.includes('environment')) {
          if (lowerLabel.includes('tele') || lowerLabel.includes('zoom')) {
            label = `🔍 Телевик / Зум: ${label}`;
          } else if (lowerLabel.includes('ultra') || lowerLabel.includes('wide')) {
            label = `📐 Ультраширик: ${label}`;
          } else {
            label = `📷 Тыловая: ${label}`;
          }
        } else if (lowerLabel.includes('front')) {
          label = `👤 Фронтальная: ${label}`;
        }

        option.textContent = label;
        if (device.deviceId === activeDeviceId) {
          option.selected = true;
          state.selectedCameraId = device.deviceId;
        }
        DOM.hostCameraSelect.appendChild(option);
      });
    } catch (err) {
      console.warn('Error enumerating cameras:', err);
    }
  }

  async function onHostCameraSelectChanged() {
    const selectedDeviceId = DOM.hostCameraSelect.value;
    if (!selectedDeviceId || selectedDeviceId === state.selectedCameraId) return;

    showToast('Переключение камеры...', 'info');
    try {
      await initializeHostCamera(selectedDeviceId);
      showToast('Объектив переключен!', 'success');
    } catch (err) {
      showToast('Не удалось переключить камеру: ' + err.message, 'error');
    }
  }

  function updateActiveViewersTracks() {
    if (!state.localStream) return;
    const newVideoTrack = state.localStream.getVideoTracks()[0];
    if (!newVideoTrack) return;

    state.hostViewers.forEach(({ call }) => {
      if (call && call.peerConnection) {
        const senders = call.peerConnection.getSenders();
        const videoSender = senders.find(s => s.track && s.track.kind === 'video');
        if (videoSender) {
          videoSender.replaceTrack(newVideoTrack).catch(err => {
            console.warn('replaceTrack error:', err);
          });
        }
      }
    });
  }

  async function onHostHardwareZoomChange(e) {
    const zoomVal = parseFloat(e.target.value);
    DOM.hostZoomValue.textContent = `${zoomVal.toFixed(1)}x`;

    const track = state.localStream?.getVideoTracks()[0];
    if (track && typeof track.applyConstraints === 'function') {
      try {
        await track.applyConstraints({
          advanced: [{ zoom: zoomVal }]
        });
      } catch (err) {
        console.warn('Apply zoom constraints error:', err);
      }
    }
  }

  async function toggleHostTorch() {
    if (!state.hasTorch || !state.localStream) return;
    const track = state.localStream.getVideoTracks()[0];
    if (!track) return;

    state.isTorchOn = !state.isTorchOn;
    try {
      await track.applyConstraints({
        advanced: [{ torch: state.isTorchOn }]
      });
      DOM.hostTorchBtn.classList.toggle('text-amber-400', state.isTorchOn);
      DOM.hostTorchBtn.classList.toggle('text-slate-400', !state.isTorchOn);
      showToast(state.isTorchOn ? 'Фонарик включен' : 'Фонарик выключен', 'info');
    } catch (err) {
      showToast('Ошибка переключения фонарика: ' + err.message, 'error');
    }
  }

  function initializeHostPeer() {
    showToast(`Создание комнаты ${state.roomCode}...`, 'info');

    // Create Peer with boardcast-XXXX id
    state.peer = new Peer(state.peerId, PEER_CONFIG);

    state.peer.on('open', (id) => {
      console.log('Host Peer open with ID:', id);
      showToast(`Трансляция готова! Код: ${state.roomCode}`, 'success');
      updateHostViewersCount();
    });

    // Handle incoming video calls from classmates
    state.peer.on('call', (mediaConnection) => {
      const viewerPeerId = mediaConnection.peer;
      console.log('Incoming call from viewer:', viewerPeerId);

      // Answer call with local video stream
      mediaConnection.answer(state.localStream);

      // Store in viewers map
      let viewerRecord = state.hostViewers.get(viewerPeerId) || {};
      viewerRecord.call = mediaConnection;
      state.hostViewers.set(viewerPeerId, viewerRecord);
      updateHostViewersCount();

      mediaConnection.on('close', () => {
        state.hostViewers.delete(viewerPeerId);
        updateHostViewersCount();
      });

      mediaConnection.on('error', (err) => {
        console.warn('MediaConnection error for viewer:', viewerPeerId, err);
        state.hostViewers.delete(viewerPeerId);
        updateHostViewersCount();
      });
    });

    // Handle incoming data connections (for HQ Photo requests)
    state.peer.on('connection', (dataConnection) => {
      const viewerPeerId = dataConnection.peer;
      console.log('Incoming DataChannel connection from:', viewerPeerId);

      let viewerRecord = state.hostViewers.get(viewerPeerId) || {};
      viewerRecord.dataConn = dataConnection;
      state.hostViewers.set(viewerPeerId, viewerRecord);

      dataConnection.on('open', () => {
        // Send initial handshake
        dataConnection.send({
          type: 'ROOM_INFO',
          roomCode: state.roomCode,
          resolution: DOM.hostStreamResolution.textContent
        });
      });

      dataConnection.on('data', async (data) => {
        if (!data || typeof data !== 'object') return;

        // Classmate pressed "Сделать четкий снимок"
        if (data.type === 'TAKE_HQ_PHOTO') {
          console.log('HQ Photo requested by viewer:', viewerPeerId);
          try {
            const hqDataUrl = await captureHostHQPhoto();
            dataConnection.send({
              type: 'HQ_PHOTO_DATA',
              dataUrl: hqDataUrl,
              timestamp: Date.now()
            });
          } catch (err) {
            console.error('Failed to capture HQ photo for peer:', err);
            dataConnection.send({
              type: 'HQ_PHOTO_ERROR',
              message: 'Не удалось сделать снимок на хосте'
            });
          }
        }
      });

      dataConnection.on('close', () => {
        state.hostViewers.delete(viewerPeerId);
        updateHostViewersCount();
      });
    });

    // Handle Peer errors (e.g. room code already in use)
    state.peer.on('error', (err) => {
      console.error('Host PeerJS error:', err);
      if (err.type === 'unavailable-id') {
        showToast(`Код ${state.roomCode} уже занят. Создаем новый...`, 'warning');
        state.roomCode = generate4DigitCode();
        state.peerId = `boardcast-${state.roomCode}`;
        DOM.hostRoomCodeDisplay.textContent = state.roomCode;
        DOM.qrModalCodeText.textContent = state.roomCode;
        setTimeout(initializeHostPeer, 500);
      } else {
        showToast(`Ошибка соединения: ${err.type || 'P2P Network'}`, 'error');
      }
    });

    state.peer.on('disconnected', () => {
      console.warn('Host Peer disconnected from signaling server, reconnecting...');
      state.peer.reconnect();
    });
  }

  function updateHostViewersCount() {
    const count = state.hostViewers.size;
    DOM.hostViewersCount.textContent = count;
    DOM.amoledViewersCount.textContent = count;
  }

  // Grab full resolution picture from camera stream
  async function captureHostHQPhoto() {
    // Attempt 1: ImageCapture API if available
    const track = state.localStream?.getVideoTracks()[0];
    if (window.ImageCapture && track) {
      try {
        const imageCapture = new window.ImageCapture(track);
        const blob = await imageCapture.takePhoto();
        return await blobToDataUrl(blob);
      } catch (e) {
        console.warn('ImageCapture takePhoto fallback to canvas:', e);
      }
    }

    // Attempt 2: High-resolution Canvas snapshot from video element
    const canvas = DOM.hostSnapshotCanvas;
    const video = DOM.hostVideoPreview;
    const width = video.videoWidth || 1920;
    const height = video.videoHeight || 1080;

    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(video, 0, 0, width, height);

    // Return high quality JPEG
    return canvas.toDataURL('image/jpeg', 0.90);
  }

  function blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }

  // Screen Wake Lock API handling
  async function requestScreenWakeLock() {
    if ('wakeLock' in navigator) {
      try {
        state.wakeLock = await navigator.wakeLock.request('screen');
        DOM.wakeLockStatus.classList.remove('opacity-50');
        state.wakeLock.addEventListener('release', () => {
          DOM.wakeLockStatus.classList.add('opacity-50');
        });
      } catch (err) {
        console.warn('WakeLock request error:', err);
        DOM.wakeLockStatus.classList.add('opacity-50');
      }
    } else {
      DOM.wakeLockStatus.classList.add('opacity-50');
    }
  }

  function releaseScreenWakeLock() {
    if (state.wakeLock) {
      state.wakeLock.release().catch(() => {});
      state.wakeLock = null;
    }
  }

  // AMOLED Black Battery Saver Mode
  function enterAmoledMode() {
    state.isAmoledActive = true;
    DOM.amoledOverlay.classList.remove('hidden');
    DOM.amoledOverlay.classList.add('flex');
    updateHostViewersCount();
    showToast('Режим AMOLED активен. Двойной тап для возврата', 'info');
  }

  function exitAmoledMode() {
    state.isAmoledActive = false;
    DOM.amoledOverlay.classList.add('hidden');
    DOM.amoledOverlay.classList.remove('flex');
  }

  function handleAmoledClick() {
    const now = Date.now();
    if (now - state.zoom.lastTapTime < 400) {
      // Double tap detected!
      exitAmoledMode();
    } else {
      state.zoom.lastTapTime = now;
    }
  }

  // ==========================================================================
  // MODE 2: VIEWER LOGIC («СМОТРЕТЬ ДОСКУ»)
  // ==========================================================================
  function joinRoomAsViewer(roomCode) {
    state.roomCode = roomCode;
    DOM.viewerRoomCodeDisplay.textContent = roomCode;
    DOM.viewerLoadingOverlay.classList.remove('hidden');
    updateViewerStatus('connecting', 'Подключение к хосту...');

    // Update URL without reloading so student can bookmark or share
    const currentUrl = new URL(window.location.href);
    currentUrl.searchParams.set('room', roomCode);
    window.history.replaceState({}, '', currentUrl.toString());

    // Create anonymous viewer Peer
    if (state.peer) {
      try { state.peer.destroy(); } catch (e) {}
    }

    state.peer = new Peer(PEER_CONFIG);

    state.peer.on('open', (viewerId) => {
      console.log('Viewer peer opened with ID:', viewerId);
      connectToHostRoom();
    });

    state.peer.on('error', (err) => {
      console.error('Viewer PeerJS error:', err);
      updateViewerStatus('error', 'Ошибка P2P соединения');
      showToast(`Ошибка: ${err.message || 'Хост не найден или код неверен'}`, 'error');
    });

    state.peer.on('disconnected', () => {
      updateViewerStatus('warning', 'Переподключение...');
      state.peer.reconnect();
    });
  }

  function connectToHostRoom() {
    const targetHostPeerId = `boardcast-${state.roomCode}`;
    showToast(`Поиск доски ${state.roomCode}...`, 'info');

    // 1. Establish MediaConnection (receive video stream)
    // Create dummy silent audio track to initiate call if required
    const dummyCanvas = document.createElement('canvas');
    dummyCanvas.width = 1;
    dummyCanvas.height = 1;
    const dummyStream = dummyCanvas.captureStream ? dummyCanvas.captureStream(1) : new MediaStream();

    const call = state.peer.call(targetHostPeerId, dummyStream);
    state.activeCall = call;

    call.on('stream', (remoteStream) => {
      console.log('Received remote stream from Host!');
      state.remoteStream = remoteStream;
      DOM.viewerVideo.srcObject = remoteStream;
      DOM.viewerVideo.play().catch(e => console.warn('Video play prevented:', e));

      DOM.viewerLoadingOverlay.classList.add('hidden');
      updateViewerStatus('connected', 'В прямом эфире');
      showToast('Подключено к трансляции доски!', 'success');
    });

    call.on('close', () => {
      updateViewerStatus('error', 'Трансляция завершена хостом');
      showToast('Хост завершил трансляцию', 'warning');
    });

    call.on('error', (err) => {
      console.error('Call error:', err);
      updateViewerStatus('error', 'Связь потеряна');
    });

    // 2. Establish DataConnection (for HQ Photos & telemetry)
    const conn = state.peer.connect(targetHostPeerId, { reliable: true });
    state.activeDataConn = conn;

    conn.on('open', () => {
      console.log('DataConnection to Host established!');
    });

    conn.on('data', (data) => {
      if (!data || typeof data !== 'object') return;

      if (data.type === 'HQ_PHOTO_DATA') {
        onReceivedHQPhoto(data.dataUrl);
      } else if (data.type === 'HQ_PHOTO_ERROR') {
        showToast(data.message || 'Ошибка снимка', 'error');
      }
    });

    conn.on('close', () => {
      console.log('DataConnection closed');
    });
  }

  function updateViewerStatus(status, text) {
    DOM.viewerStateText.textContent = text;
    const dot = DOM.viewerConnectionState.querySelector('span:first-child');

    if (status === 'connected') {
      DOM.viewerConnectionState.className = 'flex items-center gap-1.5 px-2.5 py-1 rounded-xl bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 text-xs font-medium';
      if (dot) dot.className = 'w-2 h-2 rounded-full bg-emerald-400 animate-pulse';
    } else if (status === 'connecting' || status === 'warning') {
      DOM.viewerConnectionState.className = 'flex items-center gap-1.5 px-2.5 py-1 rounded-xl bg-amber-500/10 text-amber-400 border border-amber-500/20 text-xs font-medium';
      if (dot) dot.className = 'w-2 h-2 rounded-full bg-amber-400 animate-ping';
    } else {
      DOM.viewerConnectionState.className = 'flex items-center gap-1.5 px-2.5 py-1 rounded-xl bg-red-500/10 text-red-400 border border-red-500/20 text-xs font-medium';
      if (dot) dot.className = 'w-2 h-2 rounded-full bg-red-400';
    }
  }

  // ==========================================================================
  // READABILITY FILTERS («УЛУЧШАЙЗЕР ДОСКИ»)
  // ==========================================================================
  function applyReadabilityFilter(filterType) {
    state.currentFilter = filterType;

    // Update button visual styles
    DOM.filterButtons.forEach(btn => {
      const isTarget = btn.getAttribute('data-filter') === filterType;
      btn.classList.toggle('active', isTarget);
    });

    // Remove old filter classes from video and canvas
    const filterClasses = ['filter-normal', 'filter-chalk', 'filter-marker', 'filter-invert', 'filter-bw-sharp'];
    DOM.viewerVideo.classList.remove(...filterClasses);
    DOM.freezeCanvas.classList.remove(...filterClasses);

    // Add selected class
    const newClass = `filter-${filterType}`;
    DOM.viewerVideo.classList.add(newClass);
    DOM.freezeCanvas.classList.add(newClass);

    const filterNames = {
      normal: 'Обычный цвет',
      chalk: 'Четкий мел (контраст)',
      marker: 'Антиблик маркера',
      invert: 'Инверсия (белый лист)',
      'bw-sharp': 'Ч/Б резкость сканера'
    };
    showToast(`Фильтр: ${filterNames[filterType] || filterType}`, 'info', 1500);
  }

  // ==========================================================================
  // FREEZE FRAME («СТОП-КАДР»)
  // ==========================================================================
  function toggleFreezeFrame() {
    if (state.isFrozen) {
      // Unfreeze: resume live stream
      state.isFrozen = false;
      DOM.freezeCanvas.classList.add('hidden');
      DOM.viewerVideo.classList.remove('hidden');
      DOM.viewerVideo.play().catch(() => {});

      DOM.freezeBadge.classList.add('hidden');
      DOM.freezeBadge.classList.remove('flex');
      DOM.freezeIconPause.classList.remove('hidden');
      DOM.freezeIconPlay.classList.add('hidden');
      DOM.freezeBtnText.textContent = 'Стоп-кадр';
      DOM.freezeToggleBtn.classList.remove('bg-amber-500/20', 'border-amber-500/40');

      showToast('▶ Возврат в прямой эфир!', 'success', 2000);
    } else {
      // Freeze: capture current frame into canvas
      if (!DOM.viewerVideo.videoWidth) {
        showToast('Видеопоток еще загружается', 'warning');
        return;
      }

      state.isFrozen = true;
      const canvas = DOM.freezeCanvas;
      canvas.width = DOM.viewerVideo.videoWidth;
      canvas.height = DOM.viewerVideo.videoHeight;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(DOM.viewerVideo, 0, 0, canvas.width, canvas.height);

      DOM.viewerVideo.classList.add('hidden');
      DOM.freezeCanvas.classList.remove('hidden');

      DOM.freezeBadge.classList.remove('hidden');
      DOM.freezeBadge.classList.add('flex');
      DOM.freezeIconPause.classList.add('hidden');
      DOM.freezeIconPlay.classList.remove('hidden');
      DOM.freezeBtnText.textContent = 'В эфир';
      DOM.freezeToggleBtn.classList.add('bg-amber-500/20', 'border-amber-500/40');

      showToast('⏸ Стоп-кадр зафиксирован! Списывай спокойно.', 'info', 3000);
    }
  }

  // ==========================================================================
  // HQ SNAPSHOT & GALLERY («СДЕЛАТЬ СНИМОК» И «ГАЛЕРЕЯ ПАРЫ»)
  // ==========================================================================
  function requestOrTakeSnapshot() {
    showToast('📸 Захват четкого кадра...', 'info');

    // If freeze mode is active, take snapshot directly from freeze canvas
    if (state.isFrozen) {
      const dataUrl = DOM.freezeCanvas.toDataURL('image/jpeg', 0.95);
      savePhotoToGallery(dataUrl);
      return;
    }

    // Try requesting HQ photo from Host via DataChannel
    if (state.activeDataConn && state.activeDataConn.open) {
      state.activeDataConn.send({ type: 'TAKE_HQ_PHOTO' });

      // Fallback timer: if host response takes > 2s, capture local stream
      const fallbackTimeout = setTimeout(() => {
        captureLocalSnapshotFallback();
      }, 2200);

      state._snapshotFallbackTimer = fallbackTimeout;
    } else {
      // Data channel not open, take local stream snapshot
      captureLocalSnapshotFallback();
    }
  }

  function captureLocalSnapshotFallback() {
    if (state._snapshotFallbackTimer) {
      clearTimeout(state._snapshotFallbackTimer);
      state._snapshotFallbackTimer = null;
    }

    if (!DOM.viewerVideo.videoWidth) {
      showToast('Не удалось получить кадр', 'error');
      return;
    }

    const canvas = document.createElement('canvas');
    canvas.width = DOM.viewerVideo.videoWidth;
    canvas.height = DOM.viewerVideo.videoHeight;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(DOM.viewerVideo, 0, 0, canvas.width, canvas.height);

    const dataUrl = canvas.toDataURL('image/jpeg', 0.92);
    savePhotoToGallery(dataUrl);
  }

  function onReceivedHQPhoto(dataUrl) {
    if (state._snapshotFallbackTimer) {
      clearTimeout(state._snapshotFallbackTimer);
      state._snapshotFallbackTimer = null;
    }
    savePhotoToGallery(dataUrl);
  }

  function savePhotoToGallery(dataUrl) {
    const now = new Date();
    const timeFormatted = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const photo = {
      id: Date.now(),
      dataUrl: dataUrl,
      timeFormatted: timeFormatted,
      dateFormatted: now.toLocaleDateString()
    };

    state.gallery.unshift(photo);
    persistGallery();
    renderGallery();
    updateGalleryBadges();

    showToast('Снимок сохранен в Галерею пары!', 'success');
  }

  function updateGalleryBadges() {
    const count = state.gallery.length;
    DOM.galleryCountBadge.textContent = count;
    DOM.viewerGalleryBadge.textContent = count;
    DOM.galleryDrawerCount.textContent = `${count} снимков`;
  }

  function renderGallery() {
    DOM.galleryGrid.innerHTML = '';

    if (state.gallery.length === 0) {
      DOM.galleryEmptyState.classList.remove('hidden');
      DOM.galleryGrid.appendChild(DOM.galleryEmptyState);
      return;
    }

    DOM.galleryEmptyState.classList.add('hidden');

    state.gallery.forEach((photo) => {
      const card = document.createElement('div');
      card.className = 'group relative rounded-2xl overflow-hidden bg-slate-950 border border-slate-800 shadow-md aspect-video sm:aspect-[4/3] flex flex-col justify-end';

      card.innerHTML = `
        <img src="${photo.dataUrl}" alt="Снимок доски ${photo.timeFormatted}" class="absolute inset-0 w-full h-full object-cover group-hover:scale-105 transition duration-300 cursor-pointer" />
        <div class="relative z-10 p-2 bg-gradient-to-t from-black/90 via-black/50 to-transparent flex items-center justify-between">
          <span class="text-[11px] font-mono text-slate-300">${photo.timeFormatted}</span>
          <div class="flex items-center gap-1.5">
            <button class="download-photo-btn p-1.5 rounded-lg bg-white/10 hover:bg-brand-600 text-white transition active:scale-90" title="Скачать">
              <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"/>
              </svg>
            </button>
            <button class="delete-photo-btn p-1.5 rounded-lg bg-white/10 hover:bg-red-600 text-slate-300 hover:text-white transition active:scale-90" title="Удалить">
              <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/>
              </svg>
            </button>
          </div>
        </div>
      `;

      // Click image to preview full-screen
      const imgEl = card.querySelector('img');
      imgEl.addEventListener('click', () => openPhotoPreview(photo));

      // Download single photo
      const downloadBtn = card.querySelector('.download-photo-btn');
      downloadBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        triggerDownload(photo.dataUrl, `BoardCast_${state.roomCode || 'photo'}_${photo.timeFormatted.replace(/:/g, '-')}.jpg`);
      });

      // Delete photo
      const deleteBtn = card.querySelector('.delete-photo-btn');
      deleteBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        state.gallery = state.gallery.filter(p => p.id !== photo.id);
        persistGallery();
        renderGallery();
        updateGalleryBadges();
        showToast('Снимок удален', 'info', 1500);
      });

      DOM.galleryGrid.appendChild(card);
    });
  }

  function openPhotoPreview(photo) {
    DOM.photoPreviewImg.src = photo.dataUrl;
    DOM.photoPreviewTime.textContent = `${photo.dateFormatted} • ${photo.timeFormatted}`;
    DOM.photoPreviewDownloadLink.href = photo.dataUrl;
    DOM.photoPreviewDownloadLink.download = `BoardCast_${state.roomCode || 'photo'}_${photo.timeFormatted.replace(/:/g, '-')}.jpg`;
    DOM.photoPreviewModal.classList.remove('hidden');
    DOM.photoPreviewModal.classList.add('flex');
  }

  function closePhotoPreview() {
    DOM.photoPreviewModal.classList.add('hidden');
    DOM.photoPreviewModal.classList.remove('flex');
  }

  function openGalleryDrawer() {
    renderGallery();
    DOM.galleryDrawer.classList.remove('hidden');
    DOM.galleryDrawer.classList.add('flex');
  }

  function closeGalleryDrawer() {
    DOM.galleryDrawer.classList.add('hidden');
    DOM.galleryDrawer.classList.remove('flex');
  }

  function downloadAllGalleryPhotos() {
    if (state.gallery.length === 0) {
      showToast('Нет снимков для скачивания', 'warning');
      return;
    }
    showToast(`Скачивание ${state.gallery.length} снимков...`, 'info');
    state.gallery.forEach((photo, idx) => {
      setTimeout(() => {
        triggerDownload(photo.dataUrl, `BoardCast_Lecture_${idx + 1}_${photo.timeFormatted.replace(/:/g, '-')}.jpg`);
      }, idx * 350);
    });
  }

  function triggerDownload(url, filename) {
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }

  function persistGallery() {
    try {
      // Store in sessionStorage to survive tab refresh during lecture
      sessionStorage.setItem('boardcast_gallery', JSON.stringify(state.gallery));
    } catch (e) {
      console.warn('Storage quota exceeded:', e);
    }
  }

  function loadPersistedGallery() {
    try {
      const saved = sessionStorage.getItem('boardcast_gallery');
      if (saved) {
        state.gallery = JSON.parse(saved);
        updateGalleryBadges();
      }
    } catch (e) {
      state.gallery = [];
    }
  }

  // ==========================================================================
  // INTERACTIVE ZOOM & PAN (PINCH-TO-ZOOM + MOUSE WHEEL)
  // ==========================================================================
  function setupViewerPinchAndPan() {
    const vp = DOM.videoViewport;
    const target = DOM.videoTransformWrapper;

    function applyTransform() {
      target.style.transform = `translate(${state.zoom.x}px, ${state.zoom.y}px) scale(${state.zoom.scale})`;
      DOM.zoomLevelDisplay.textContent = `${state.zoom.scale.toFixed(1)}x`;

      const isZoomed = state.zoom.scale > 1.05;
      DOM.resetZoomBtn.classList.toggle('hidden', !isZoomed);
      DOM.zoomHintOverlay.classList.toggle('opacity-0', isZoomed);
    }

    // Touch events for Pinch & Drag
    let initialTouches = [];

    vp.addEventListener('touchstart', (e) => {
      if (e.touches.length === 2) {
        // Pinch start
        state.zoom.initialDistance = getTouchDistance(e.touches[0], e.touches[1]);
        state.zoom.initialScale = state.zoom.scale;
      } else if (e.touches.length === 1) {
        // Drag start (only if zoomed in)
        state.zoom.isPanning = true;
        state.zoom.startX = e.touches[0].clientX - state.zoom.x;
        state.zoom.startY = e.touches[0].clientY - state.zoom.y;

        // Double tap to toggle 2.5x zoom
        const now = Date.now();
        if (now - state.zoom.lastTapTime < 300) {
          if (state.zoom.scale > 1.5) {
            resetViewerZoom();
          } else {
            state.zoom.scale = 2.5;
            state.zoom.x = 0;
            state.zoom.y = 0;
            applyTransform();
          }
        }
        state.zoom.lastTapTime = now;
      }
    }, { passive: false });

    vp.addEventListener('touchmove', (e) => {
      if (e.touches.length === 2) {
        e.preventDefault();
        const currentDistance = getTouchDistance(e.touches[0], e.touches[1]);
        if (state.zoom.initialDistance > 0) {
          const factor = currentDistance / state.zoom.initialDistance;
          let newScale = state.zoom.initialScale * factor;
          newScale = Math.max(state.zoom.minScale, Math.min(newScale, state.zoom.maxScale));
          state.zoom.scale = newScale;
          applyTransform();
        }
      } else if (e.touches.length === 1 && state.zoom.isPanning && state.zoom.scale > 1.05) {
        e.preventDefault();
        state.zoom.x = e.touches[0].clientX - state.zoom.startX;
        state.zoom.y = e.touches[0].clientY - state.zoom.startY;
        applyTransform();
      }
    }, { passive: false });

    vp.addEventListener('touchend', (e) => {
      if (e.touches.length < 2) {
        state.zoom.initialDistance = 0;
      }
      if (e.touches.length === 0) {
        state.zoom.isPanning = false;
      }
    });

    // Mouse Wheel zoom (for laptop/PC users)
    vp.addEventListener('wheel', (e) => {
      e.preventDefault();
      const zoomFactor = e.deltaY < 0 ? 1.15 : 0.85;
      let newScale = state.zoom.scale * zoomFactor;
      newScale = Math.max(state.zoom.minScale, Math.min(newScale, state.zoom.maxScale));

      state.zoom.scale = newScale;
      if (state.zoom.scale === 1) {
        state.zoom.x = 0;
        state.zoom.y = 0;
      }
      applyTransform();
    }, { passive: false });

    // Mouse drag
    let isMouseDown = false;
    vp.addEventListener('mousedown', (e) => {
      if (state.zoom.scale > 1.05) {
        isMouseDown = true;
        state.zoom.startX = e.clientX - state.zoom.x;
        state.zoom.startY = e.clientY - state.zoom.y;
      }
    });

    window.addEventListener('mousemove', (e) => {
      if (isMouseDown && state.zoom.scale > 1.05) {
        state.zoom.x = e.clientX - state.zoom.startX;
        state.zoom.y = e.clientY - state.zoom.startY;
        applyTransform();
      }
    });

    window.addEventListener('mouseup', () => {
      isMouseDown = false;
    });

    // Double click to zoom
    vp.addEventListener('dblclick', (e) => {
      if (state.zoom.scale > 1.5) {
        resetViewerZoom();
      } else {
        state.zoom.scale = 2.5;
        state.zoom.x = 0;
        state.zoom.y = 0;
        applyTransform();
      }
    });
  }

  function getTouchDistance(t1, t2) {
    const dx = t1.clientX - t2.clientX;
    const dy = t1.clientY - t2.clientY;
    return Math.hypot(dx, dy);
  }

  function resetViewerZoom() {
    state.zoom.scale = 1;
    state.zoom.x = 0;
    state.zoom.y = 0;
    DOM.videoTransformWrapper.style.transform = `translate(0px, 0px) scale(1)`;
    DOM.zoomLevelDisplay.textContent = '1.0x';
    DOM.resetZoomBtn.classList.add('hidden');
    DOM.zoomHintOverlay.classList.remove('opacity-0');
    showToast('Зум сброшен', 'info', 1000);
  }

  function toggleFullscreen() {
    const elem = DOM.videoViewport;
    if (!document.fullscreenElement) {
      if (elem.requestFullscreen) {
        elem.requestFullscreen();
      } else if (elem.webkitRequestFullscreen) {
        elem.webkitRequestFullscreen();
      }
    } else {
      if (document.exitFullscreen) {
        document.exitFullscreen();
      }
    }
  }

  // ==========================================================================
  // QR CODE & SHARING
  // ==========================================================================
  function getShareUrl() {
    const url = new URL(window.location.href);
    url.searchParams.set('room', state.roomCode);
    return url.toString();
  }

  function openQrModal() {
    const shareUrl = getShareUrl();
    DOM.qrModalCodeText.textContent = state.roomCode;

    // Generate or update QR Code
    DOM.qrcodeBox.innerHTML = '';
    if (window.QRCode) {
      qrcodeInstance = new QRCode(DOM.qrcodeBox, {
        text: shareUrl,
        width: 208,
        height: 208,
        colorDark: '#050608',
        colorLight: '#ffffff',
        correctLevel: QRCode.CorrectLevel.M
      });
    }

    DOM.qrModal.classList.remove('hidden');
    DOM.qrModal.classList.add('flex');
  }

  function closeQrModal() {
    DOM.qrModal.classList.add('hidden');
    DOM.qrModal.classList.remove('flex');
  }

  async function copyRoomLinkToClipboard() {
    const url = getShareUrl();
    try {
      await navigator.clipboard.writeText(url);
      showToast('Ссылка скопирована в буфер обмена!', 'success');
    } catch (err) {
      // Fallback
      prompt('Скопируй ссылку на трансляцию:', url);
    }
  }

  async function shareRoomLinkNative() {
    const shareUrl = getShareUrl();
    if (navigator.share) {
      try {
        await navigator.share({
          title: `BoardCast — Трансляция доски (${state.roomCode})`,
          text: `Подключайся к трансляции доски с первого ряда! Код: ${state.roomCode}`,
          url: shareUrl
        });
      } catch (err) {
        if (err.name !== 'AbortError') {
          copyRoomLinkToClipboard();
        }
      }
    } else {
      copyRoomLinkToClipboard();
    }
  }

  // ==========================================================================
  // TOAST NOTIFICATIONS
  // ==========================================================================
  function showToast(message, type = 'info', duration = 3000) {
    const toast = document.createElement('div');
    toast.className = 'toast-item pointer-events-auto flex items-center gap-2.5 px-4 py-3 rounded-2xl shadow-xl backdrop-blur-md text-xs font-medium border';

    let iconSvg = '';
    if (type === 'success') {
      toast.classList.add('bg-emerald-950/90', 'border-emerald-500/30', 'text-emerald-200');
      iconSvg = '<svg class="w-4 h-4 text-emerald-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"/></svg>';
    } else if (type === 'error') {
      toast.classList.add('bg-red-950/90', 'border-red-500/30', 'text-red-200');
      iconSvg = '<svg class="w-4 h-4 text-red-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/></svg>';
    } else if (type === 'warning') {
      toast.classList.add('bg-amber-950/90', 'border-amber-500/30', 'text-amber-200');
      iconSvg = '<svg class="w-4 h-4 text-amber-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/></svg>';
    } else {
      toast.classList.add('bg-slate-900/90', 'border-slate-700/60', 'text-slate-200');
      iconSvg = '<svg class="w-4 h-4 text-brand-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>';
    }

    toast.innerHTML = `${iconSvg}<span>${message}</span>`;
    DOM.toastContainer.appendChild(toast);

    // Animate in
    requestAnimationFrame(() => {
      toast.classList.add('show');
    });

    // Auto dismiss
    setTimeout(() => {
      toast.classList.remove('show');
      toast.classList.add('hide');
      setTimeout(() => {
        if (toast.parentNode) toast.parentNode.removeChild(toast);
      }, 300);
    }, duration);
  }

  // ==========================================================================
  // CLEANUP & LEAVE ROOM
  // ==========================================================================
  function confirmLeaveRoom() {
    const isHost = state.mode === 'host';
    const message = isHost 
      ? 'Завершить трансляцию для всех зрителей?' 
      : 'Отключиться от трансляции доски?';

    if (confirm(message)) {
      cleanupAndReturnHome();
    }
  }

  function cleanupAndReturnHome() {
    // 1. Stop local camera tracks
    if (state.localStream) {
      state.localStream.getTracks().forEach(track => track.stop());
      state.localStream = null;
    }

    // 2. Release wake lock
    releaseScreenWakeLock();

    // 3. Close peer connections
    if (state.peer) {
      try {
        state.peer.destroy();
      } catch (e) {}
      state.peer = null;
    }

    state.hostViewers.clear();
    state.activeCall = null;
    state.activeDataConn = null;
    state.remoteStream = null;
    state.isFrozen = false;
    exitAmoledMode();

    // 4. Clear video src
    DOM.hostVideoPreview.srcObject = null;
    DOM.viewerVideo.srcObject = null;

    // 5. Clear URL parameter
    const cleanUrl = new URL(window.location.href);
    cleanUrl.searchParams.delete('room');
    window.history.replaceState({}, '', cleanUrl.pathname);

    // 6. Switch back to home
    switchView('home');
    showToast('Вы вышли на главный экран', 'info');
  }

  // Run app on DOM load
  document.addEventListener('DOMContentLoaded', initApp);

})();
