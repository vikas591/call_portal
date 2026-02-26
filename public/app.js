// Supabase Configuration
const SUPABASE_URL = 'https://uwztrtydrkfmvrrwpimn.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InV3enRydHlkcmtmbXZycndwaW1uIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE4MjQyNTUsImV4cCI6MjA4NzQwMDI1NX0.i42mRaAdxA1zKQanyPshBpqGP25YVfiPvgxbJvdvVmA';

const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// State management
let currentUser = JSON.parse(localStorage.getItem('user')) || null;
let activeCallId = null;
let callTimerInterval = null;
const sessionStartTime = new Date().getTime();

// WebRTC State
let localStream = null;
let peerConnection = null;
let signalingChannel = null;

const rtcConfig = {
    iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
};

// --- Particles.js Configuration ---
function initParticles() {
    if (typeof particlesJS !== 'undefined') {
        particlesJS('particles-js', {
            "particles": {
                "number": { "value": 80, "density": { "enable": true, "value_area": 800 } },
                "color": { "value": "#ffffff" },
                "shape": { "type": "circle" },
                "opacity": { "value": 0.5, "random": false },
                "size": { "value": 3, "random": true },
                "line_linked": { "enable": true, "distance": 150, "color": "#ffffff", "opacity": 0.4, "width": 1 },
                "move": { "enable": true, "speed": 6, "direction": "none", "random": false, "straight": false, "out_mode": "out", "bounce": false }
            },
            "interactivity": {
                "detect_on": "canvas",
                "events": { "onhover": { "enable": true, "mode": "repulse" }, "onclick": { "enable": true, "mode": "push" }, "resize": true },
                "modes": { "grab": { "distance": 400, "line_linked": { "opacity": 1 } }, "bubble": { "distance": 400, "size": 40, "duration": 2, "opacity": 8, "speed": 3 }, "repulse": { "distance": 200, "duration": 0.4 }, "push": { "particles_nb": 4 }, "remove": { "particles_nb": 2 } }
            },
            "retina_detect": true
        });
    }
}

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    initParticles();
    console.log("RollConnect v1.0.2 Initialized");

    // Check for secure context (HTTPS/localhost)
    if (!window.isSecureContext) {
        showToast("⚠️ Browser security may block your microphone. Use HTTPS for best results.", 10000);
    }

    if (document.getElementById('login-form')) {
        initAuthFlow();
    } else if (document.getElementById('welcome-name')) {
        initDashboard();
        restoreCallState();
    }
});

// --- Audio Unlocking ---
let audioUnlocked = false;
function unlockAudio() {
    if (audioUnlocked) return;
    const elements = ['remote-audio', 'ringtone-audio', 'dialtone-audio'];
    elements.forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            el.play().then(() => {
                el.pause();
                el.currentTime = 0;
            }).catch(e => console.log(`Failed to unlock ${id}:`, e));
        }
    });
    audioUnlocked = true;
    console.log("Audio elements unlocked via user interaction.");
}

document.body.addEventListener('click', unlockAudio, { once: true });
document.body.addEventListener('touchstart', unlockAudio, { once: true });

// --- Call State Persistence ---
function saveCallState(targetRoll, targetName) {
    if (!activeCallId) return;
    const state = {
        activeCallId,
        targetRoll,
        targetName,
        startTime: new Date().getTime()
    };
    localStorage.setItem('active_call_state', JSON.stringify(state));
}

function clearCallState() {
    localStorage.removeItem('active_call_state');
}

async function restoreCallState() {
    const saved = localStorage.getItem('active_call_state');
    if (!saved) return;

    try {
        const state = JSON.parse(saved);
        const { data: call, error } = await supabaseClient.from('calls').select('*').eq('id', state.activeCallId).single();

        if (error || !['accepted', 'calling'].includes(call.status)) {
            clearCallState();
            return;
        }

        activeCallId = state.activeCallId;
        showActiveCallUI(state.targetName);

        if (call.status === 'accepted') {
            await createPeerConnection(state.targetRoll);
            startTimer();

            // On refresh, audio is often blocked until user interaction
            if (!audioUnlocked) {
                showToast("🔊 Tap anywhere to resume audio", 6000);
            }
        }
    } catch (err) {
        console.error("Failed to restore call:", err);
        clearCallState();
    }
}

// --- UI Helpers ---
function showToast(message, duration = 3000) {
    const container = document.getElementById('toast-container');
    if (!container) return;
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.innerText = message;
    container.prepend(toast);
    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateX(20px)';
        setTimeout(() => toast.remove(), 400);
    }, duration);
}

// --- Authentication Flow ---
let isRegMode = false; // State outside to persist between toggles

function initAuthFlow() {
    if (currentUser) {
        window.location.href = 'dashboard.html';
        return;
    }

    const loginForm = document.getElementById('login-form');
    const nameGroup = document.getElementById('name-group');
    const authSubmit = document.getElementById('auth-submit');
    const errorArea = document.getElementById('error-area');
    const authToggle = document.getElementById('auth-toggle');
    const authSubtitle = document.getElementById('auth-subtitle');
    const toggleWrapper = document.getElementById('auth-toggle-wrapper');

    function updateUI() {
        if (isRegMode) {
            nameGroup.classList.remove('hidden');
            document.getElementById('reg-name').required = true;
            authSubmit.innerText = "Complete Registration";
            authSubtitle.innerText = "Join the RollConnect Community";
            toggleWrapper.innerHTML = `Already registered? <a href="#" id="auth-toggle" style="color: var(--accent-cyan); font-weight: 700; text-decoration: none;">Login Now</a>`;
        } else {
            nameGroup.classList.add('hidden');
            document.getElementById('reg-name').required = false;
            authSubmit.innerText = "Enter Dashboard";
            authSubtitle.innerText = "College Communication Portal";
            toggleWrapper.innerHTML = `New student? <a href="#" id="auth-toggle" style="color: var(--accent-cyan); font-weight: 700; text-decoration: none;">Register Now</a>`;
        }

        // Re-attach toggle listener since innerHTML wipes it
        const newToggle = document.getElementById('auth-toggle');
        if (newToggle) {
            newToggle.onclick = (e) => {
                e.preventDefault();
                isRegMode = !isRegMode;
                updateUI();
            };
        }
    }

    updateUI();

    loginForm.onsubmit = async (e) => {
        e.preventDefault();
        const roll_no = document.getElementById('login-roll').value.trim().toUpperCase();
        errorArea.innerText = "";

        try {
            authSubmit.disabled = true;
            authSubmit.innerText = isRegMode ? "Creating Account..." : "Authenticating...";

            if (isRegMode) {
                const name = document.getElementById('reg-name').value.trim();
                const { data: newUser, error: regError } = await supabaseClient
                    .from('users')
                    .insert([{ roll_no, name, online: true }])
                    .select().single();

                if (regError) throw regError;
                localStorage.setItem('user', JSON.stringify(newUser));
                window.location.href = 'dashboard.html';
            } else {
                const { data: user } = await supabaseClient
                    .from('users').select('*').eq('roll_no', roll_no).maybeSingle();

                if (user) {
                    await supabaseClient.from('users').update({ online: true }).eq('roll_no', user.roll_no);
                    localStorage.setItem('user', JSON.stringify(user));
                    window.location.href = 'dashboard.html';
                } else {
                    errorArea.innerText = "User not found. Please Register.";
                }
            }
        } catch (err) {
            errorArea.innerText = "Error: " + err.message;
        } finally {
            authSubmit.disabled = false;
            authSubmit.innerText = isRegMode ? "Complete Registration" : "Enter Dashboard";
        }
    };
}

// --- Dashboard ---
async function initDashboard() {
    if (!currentUser) return window.location.href = 'index.html';

    document.getElementById('welcome-name').innerText = `Hello, ${currentUser.name}!`;
    document.getElementById('my-roll').innerText = currentUser.roll_no;

    document.getElementById('logout-btn').onclick = logout;
    document.getElementById('call-btn').onclick = initiateCall;
    document.getElementById('end-call-btn').onclick = endCall;
    document.getElementById('accept-btn').onclick = acceptCall;
    document.getElementById('reject-btn').onclick = rejectCall;

    document.getElementById('mute-btn').onclick = toggleMute;
    document.getElementById('speaker-btn').onclick = toggleSpeaker;

    // Pre-warm the Mic to avoid delay during actual calls
    navigator.mediaDevices.getUserMedia({ audio: true }).then(stream => {
        localStream = stream;
        console.log("Mic pre-warmed and ready.");
    }).catch(e => console.log("Mic pre-warm skipped/blocked", e));

    await cleanupOldCalls();
    setupRealtime();
    fetchCallHistory();
}

async function fetchCallHistory() {
    try {
        const { data, error } = await supabaseClient
            .from('calls')
            .select('*')
            .or(`from_roll.eq.${currentUser.roll_no},to_roll.eq.${currentUser.roll_no}`)
            .order('created_at', { ascending: false })
            .limit(5);

        if (error) throw error;
        renderCallHistory(data);
    } catch (err) {
        console.error("Error fetching history:", err);
    }
}

function renderCallHistory(calls) {
    const historyList = document.getElementById('call-history-list');
    if (!historyList) return;

    if (!calls || calls.length === 0) {
        historyList.innerHTML = `<div class="no-history" style="color: var(--text-ghost); font-size: 0.9rem; font-style: italic;">No recent connections found.</div>`;
        return;
    }

    historyList.innerHTML = calls.map(call => {
        const isOutgoing = call.from_roll === currentUser.roll_no;
        const otherParty = isOutgoing ? call.to_roll : call.from_roll;
        const time = new Date(call.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        const date = new Date(call.created_at).toLocaleDateString([], { month: 'short', day: 'numeric' });

        let statusClass = `status-${call.status}`;
        let statusText = call.status;

        if (call.status === 'calling' && !isOutgoing) {
            statusClass = 'status-missed';
            statusText = 'missed';
        }

        if (call.status === 'accepted') {
            statusText = 'spoken';
        }

        return `
            <div class="history-item">
                <div class="history-info">
                    <span class="history-roll">${isOutgoing ? '↗' : '↙'} ${otherParty}</span>
                    <span class="history-time">${date} • ${time}</span>
                </div>
                <div class="history-actions">
                    <div class="history-status ${statusClass}">${statusText}</div>
                    <button class="btn-history-call" onclick="callFromHistory('${otherParty}')" title="Call Back">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3">
                            <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"></path>
                        </svg>
                    </button>
                </div>
            </div>
        `;
    }).join('');
}

async function callFromHistory(rollNo) {
    document.getElementById('target_roll').value = rollNo;
    await initiateCall();
}

async function cleanupOldCalls() {
    await supabaseClient.from('calls').update({ status: 'ended' }).or(`from_roll.eq.${currentUser.roll_no},to_roll.eq.${currentUser.roll_no}`).eq('status', 'calling');
}

function setupRealtime() {
    // 1. Database Changes Listener
    supabaseClient.channel('db-changes').on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'calls', filter: `to_roll=eq.${currentUser.roll_no}` }, payload => {
        const call = payload.new;
        const createdAt = new Date(call.created_at).getTime();
        if (call.status === 'calling' && createdAt >= sessionStartTime && !activeCallId) {
            showIncomingCall(call);
        }
    }).on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'calls' }, payload => {
        const call = payload.new;
        if (activeCallId && call.id === activeCallId) handleCallUpdate(call);
    }).subscribe();

    // 2. WebRTC Signaling Channel
    signalingChannel = supabaseClient.channel(`signaling:${currentUser.roll_no}`);
    signalingChannel.on('broadcast', { event: 'signal' }, payload => handleSignalingMessage(payload.payload)).subscribe();

    // 3. Automatic Online Status with Presence
    const presenceChannel = supabaseClient.channel('online-users');
    presenceChannel
        .on('presence', { event: 'sync' }, () => {
            const state = presenceChannel.presenceState();
            const isUserOnline = Object.values(state).flat().some(p => p.roll_no === currentUser.roll_no);
            updateLocalStatusDisplay(isUserOnline);
        })
        .on('presence', { event: 'join' }, ({ key, newPresences }) => {
            if (newPresences.some(p => p.roll_no === currentUser.roll_no)) {
                supabaseClient.from('users').update({ online: true }).eq('roll_no', currentUser.roll_no);
            }
        })
        .on('presence', { event: 'leave' }, ({ key, leftPresences }) => {
            if (leftPresences.some(p => p.roll_no === currentUser.roll_no)) {
                supabaseClient.from('users').update({ online: false }).eq('roll_no', currentUser.roll_no);
            }
        })
        .subscribe(async (status) => {
            if (status === 'SUBSCRIBED') {
                await presenceChannel.track({ roll_no: currentUser.roll_no, name: currentUser.name });
            }
        });
}

function updateLocalStatusDisplay(isOnline) {
    const indicator = document.getElementById('online-indicator');
    const statusText = document.getElementById('current-status-text');
    if (!indicator || !statusText) return;

    if (isOnline) {
        indicator.classList.remove('offline');
        statusText.innerText = "ONLINE";
    } else {
        indicator.classList.add('offline');
        statusText.innerText = "OFFLINE";
    }
}

// --- WebRTC Logic ---
async function createPeerConnection(target) {
    if (peerConnection) return;
    peerConnection = new RTCPeerConnection(rtcConfig);

    // Warm up the audio element for mobile browser autoplay policies
    const remoteAudio = document.getElementById('remote-audio');
    remoteAudio.play().then(() => {
        remoteAudio.pause();
        remoteAudio.currentTime = 0;
    }).catch(e => console.log("Audio warm-up blocked", e));

    try {
        if (!localStream) {
            localStream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    echoCancellation: true,
                    noiseSuppression: true,
                    autoGainControl: true,
                    sampleRate: 48000
                }
            });
        }
        localStream.getTracks().forEach(track => peerConnection.addTrack(track, localStream));
    } catch (e) {
        showToast("Mic access denied.");
    }

    peerConnection.ontrack = (event) => {
        console.log("Remote track received:", event.track.kind);
        const remoteAudio = document.getElementById('remote-audio');
        if (event.streams && event.streams[0]) {
            remoteAudio.srcObject = event.streams[0];
            remoteAudio.play().catch(e => {
                console.error("Audio playback failed:", e);
                showToast("Tap screen to enable audio");
                // Allow user to manually start audio if blocked
                document.body.addEventListener('click', () => {
                    remoteAudio.play();
                }, { once: true });
            });
        }
    };

    peerConnection.onicecandidate = (event) => {
        if (event.candidate) {
            console.log("ICE Candidate generated:", event.candidate.candidate.substring(0, 50) + "...");
            sendSignalingMessage({ type: 'candidate', candidate: event.candidate, to: target });
        }
    };

    peerConnection.oniceconnectionstatechange = () => {
        console.log("ICE Connection State:", peerConnection.iceConnectionState);
        if (peerConnection.iceConnectionState === 'failed') {
            showToast("Connection failed. Check your network.");
        }
    };

    peerConnection.onsignalingstatechange = () => {
        console.log("Signaling State:", peerConnection.signalingState);
    };

    peerConnection.onconnectionstatechange = () => {
        console.log("Total Connection State:", peerConnection.connectionState);
    };
}

function sendSignalingMessage(message) {
    supabaseClient.channel(`signaling:${message.to}`).send({ type: 'broadcast', event: 'signal', payload: { ...message, from: currentUser.roll_no } });
}

async function handleSignalingMessage(message) {
    if (message.to !== currentUser.roll_no) return;
    switch (message.type) {
        case 'offer': await handleOffer(message); break;
        case 'answer': await peerConnection?.setRemoteDescription(new RTCSessionDescription(message.answer)); break;
        case 'candidate': await peerConnection?.addIceCandidate(new RTCIceCandidate(message.candidate)); break;
    }
}

async function handleOffer(message) {
    await createPeerConnection(message.from);
    await peerConnection.setRemoteDescription(new RTCSessionDescription(message.offer));
    const answer = await peerConnection.createAnswer();
    await peerConnection.setLocalDescription(answer);
    sendSignalingMessage({ type: 'answer', answer: answer, to: message.from });
}

// --- Call Handling ---
async function initiateCall() {
    const targetRoll = document.getElementById('target_roll').value.trim().toUpperCase();
    if (!targetRoll || targetRoll === currentUser.roll_no) return;

    // 1. Instant UI Response
    showActiveCallUI(targetRoll);
    playDialTone();

    try {
        const { data: targetUser } = await supabaseClient.from('users').select('*').eq('roll_no', targetRoll).maybeSingle();
        if (!targetUser) throw new Error('User not found');
        if (!targetUser.online) throw new Error('User is currently offline');

        // Update name in UI once found
        document.getElementById('active-user-text').innerText = targetUser.name;

        showToast("Initiating secure connection...");
        const { data: call } = await supabaseClient.from('calls').insert([{ from_roll: currentUser.roll_no, to_roll: targetRoll, status: 'calling' }]).select().single();
        activeCallId = call.id;

        saveCallState(targetRoll, targetUser.name);
        await createPeerConnection(targetRoll);
        const offer = await peerConnection.createOffer();
        await peerConnection.setLocalDescription(offer);
        sendSignalingMessage({ type: 'offer', offer: offer, to: targetRoll });
    } catch (err) {
        showToast(err.message);
        resetCallUI();
    }
}

async function showIncomingCall(call) {
    if (activeCallId) return; // Guard against multiple calls or redundant events
    activeCallId = call.id;

    const { data: caller } = await supabaseClient.from('users').select('name').eq('roll_no', call.from_roll).maybeSingle();

    // Safety check in case call was ended/rejected while fetching caller info
    const { data: currentCall } = await supabaseClient.from('calls').select('status').eq('id', activeCallId).single();
    if (currentCall?.status !== 'calling') {
        activeCallId = null;
        return;
    }

    document.getElementById('caller-roll-text').innerText = call.from_roll;
    document.getElementById('modal-avatar').innerText = (caller?.name || 'U')[0];
    const modal = document.getElementById('incoming-call-modal');
    modal.style.display = 'flex';
    setTimeout(() => modal.classList.add('active'), 10);
    playRingtone();
}

async function acceptCall() {
    stopTones();
    const modal = document.getElementById('incoming-call-modal');
    modal.classList.remove('active');
    setTimeout(() => modal.style.display = 'none', 500);

    // Instant UI Transition
    const callerRoll = document.getElementById('caller-roll-text').innerText;
    showActiveCallUI(callerRoll);
    startTimer();

    try {
        await supabaseClient.from('calls').update({ status: 'accepted' }).eq('id', activeCallId);
        showToast("Connection established");

        const { data: call } = await supabaseClient.from('calls').select('*').eq('id', activeCallId).single();
        const other = call.from_roll === currentUser.roll_no ? call.to_roll : call.from_roll;
        const { data: user } = await supabaseClient.from('users').select('name').eq('roll_no', other).maybeSingle();

        if (user) document.getElementById('active-user-text').innerText = user.name;
        saveCallState(other, user?.name || other);
    } catch (err) {
        console.error("Accept call error:", err);
        resetCallUI();
    }
}

async function rejectCall() {
    stopTones();
    await supabaseClient.from('calls').update({ status: 'rejected' }).eq('id', activeCallId);
    showToast("Call declined");
    resetCallUI();
}

async function endCall() {
    stopTones();
    await supabaseClient.from('calls').update({ status: 'ended' }).eq('id', activeCallId);
    showToast("Connection terminated");
    resetCallUI();
}

function handleCallUpdate(call) {
    if (call.status === 'accepted') {
        stopTones(); // Force stop ringing/dialing on both ends
        showToast("Call Accepted");
        const other = call.from_roll === currentUser.roll_no ? call.to_roll : call.from_roll;
        const name = currentUser.roll_no === call.from_roll ? "Member" : "Partner";
        startTimer();
    } else if (['rejected', 'ended'].includes(call.status)) {
        stopTones();
        showToast(`Call ${call.status}`);
        resetCallUI();
    }
}

function showActiveCallUI(name) {
    document.getElementById('initial-ui').classList.add('hidden');
    document.getElementById('active-call-ui').classList.remove('hidden');
    document.getElementById('active-user-text').innerText = name;
    // Keep timer hidden until call is accepted
    document.getElementById('call-timer-container').classList.add('hidden');
}

function resetCallUI() {
    stopTones();
    clearCallState(); // Clear persistence state
    if (peerConnection) { peerConnection.close(); peerConnection = null; }
    if (localStream) { localStream.getTracks().forEach(t => t.stop()); localStream = null; }
    document.getElementById('initial-ui').classList.remove('hidden');
    document.getElementById('active-call-ui').classList.add('hidden');
    document.getElementById('call-timer-container').classList.add('hidden');
    const modal = document.getElementById('incoming-call-modal');
    modal.classList.remove('active');
    setTimeout(() => modal.style.display = 'none', 500);
    activeCallId = null;
    clearInterval(callTimerInterval);
    document.getElementById('call-timer').innerText = '00:00';
    fetchCallHistory();

    // Reset control button states
    document.getElementById('mute-btn').classList.remove('active');
    document.getElementById('speaker-btn').classList.remove('active');
}

function toggleMute() {
    if (!localStream) return;
    const audioTrack = localStream.getAudioTracks()[0];
    if (audioTrack) {
        audioTrack.enabled = !audioTrack.enabled;
        const btn = document.getElementById('mute-btn');
        btn.classList.toggle('active', !audioTrack.enabled);
        showToast(audioTrack.enabled ? "Microphone Unmuted" : "Microphone Muted");
    }
}

function toggleSpeaker() {
    const remoteAudio = document.getElementById('remote-audio');
    const btn = document.getElementById('speaker-btn');

    // Simple toggle simulation: Increase volume or toggle class for UI feedback
    // Real setSinkId often requires HTTPS and modern Chrome
    if (remoteAudio.volume < 1.0) {
        remoteAudio.volume = 1.0;
        btn.classList.add('active');
        showToast("Speaker Mode: ON");
    } else {
        remoteAudio.volume = 0.5;
        btn.classList.remove('active');
        showToast("Speaker Mode: OFF (Normal)");
    }
}

function startTimer() {
    document.getElementById('call-timer-container').classList.remove('hidden');
    let s = 0;
    clearInterval(callTimerInterval);
    callTimerInterval = setInterval(() => {
        s++;
        document.getElementById('call-timer').innerText = `${Math.floor(s / 60).toString().padStart(2, '0')}:${(s % 60).toString().padStart(2, '0')}`;
    }, 1000);
}

// --- Audio Tones ---
function playDialTone() {
    const dial = document.getElementById('dialtone-audio');
    if (dial) dial.play().catch(e => console.log("Audio play blocked", e));
}

function playRingtone() {
    const ring = document.getElementById('ringtone-audio');
    if (ring) ring.play().catch(e => console.log("Audio play blocked", e));
}

function stopTones() {
    const dial = document.getElementById('dialtone-audio');
    const ring = document.getElementById('ringtone-audio');
    if (dial) { dial.pause(); dial.currentTime = 0; }
    if (ring) { ring.pause(); ring.currentTime = 0; }
}

async function logout() {
    if (currentUser) await supabaseClient.from('users').update({ online: false }).eq('roll_no', currentUser.roll_no);
    localStorage.removeItem('user');
    window.location.href = 'index.html';
}
