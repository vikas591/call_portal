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
    if (document.getElementById('login-form')) {
        initAuthFlow();
    } else if (document.getElementById('welcome-name')) {
        initDashboard();
    }
});

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

        return `
            <div class="history-item">
                <div class="history-info">
                    <span class="history-roll">${isOutgoing ? '↗' : '↙'} ${otherParty}</span>
                    <span class="history-time">${date} • ${time}</span>
                </div>
                <div class="history-status ${statusClass}">${statusText}</div>
            </div>
        `;
    }).join('');
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
    try {
        if (!localStream) localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        localStream.getTracks().forEach(track => peerConnection.addTrack(track, localStream));
    } catch (e) {
        showToast("Mic access denied.");
    }
    peerConnection.ontrack = (event) => document.getElementById('remote-audio').srcObject = event.streams[0];
    peerConnection.onicecandidate = (event) => {
        if (event.candidate) sendSignalingMessage({ type: 'candidate', candidate: event.candidate, to: target });
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

    try {
        const { data: targetUser } = await supabaseClient.from('users').select('*').eq('roll_no', targetRoll).maybeSingle();
        if (!targetUser) throw new Error('User not found');
        if (!targetUser.online) throw new Error('User is currently offline');

        showToast("Initiating secure connection...");
        const { data: call } = await supabaseClient.from('calls').insert([{ from_roll: currentUser.roll_no, to_roll: targetRoll, status: 'calling' }]).select().single();
        activeCallId = call.id;

        showActiveCallUI(targetUser.name);
        playDialTone();
        await createPeerConnection(targetRoll);
        const offer = await peerConnection.createOffer();
        await peerConnection.setLocalDescription(offer);
        sendSignalingMessage({ type: 'offer', offer: offer, to: targetRoll });
    } catch (err) {
        showToast(err.message);
        stopTones();
    }
}

async function showIncomingCall(call) {
    activeCallId = call.id;
    const { data: caller } = await supabaseClient.from('users').select('name').eq('roll_no', call.from_roll).maybeSingle();
    document.getElementById('caller-roll-text').innerText = call.from_roll;
    document.getElementById('modal-avatar').innerText = (caller?.name || 'U')[0];
    const modal = document.getElementById('incoming-call-modal');
    modal.style.display = 'flex';
    setTimeout(() => modal.classList.add('active'), 10);
    playRingtone();
}

async function acceptCall() {
    stopTones();
    await supabaseClient.from('calls').update({ status: 'accepted' }).eq('id', activeCallId);
    showToast("Connection established");
    const modal = document.getElementById('incoming-call-modal');
    modal.classList.remove('active');
    setTimeout(() => modal.style.display = 'none', 500);

    const { data: call } = await supabaseClient.from('calls').select('*').eq('id', activeCallId).single();
    const other = call.from_roll === currentUser.roll_no ? call.to_roll : call.from_roll;
    const { data: user } = await supabaseClient.from('users').select('name').eq('roll_no', other).maybeSingle();
    showActiveCallUI(user?.name || other);
    startTimer();
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
        stopTones();
        showToast("Call Accepted");
        const other = call.from_roll === currentUser.roll_no ? call.to_roll : call.from_roll;
        const name = currentUser.roll_no === call.from_roll ? "Member" : "Partner";
        startTimer();
    } else if (['rejected', 'ended'].includes(call.status)) {
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
