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

// Initialize
document.addEventListener('DOMContentLoaded', () => {
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
    await supabaseClient.from('users').update({ online: true }).eq('roll_no', currentUser.roll_no);
    setupRealtime();
}

async function cleanupOldCalls() {
    await supabaseClient.from('calls').update({ status: 'ended' }).or(`from_roll.eq.${currentUser.roll_no},to_roll.eq.${currentUser.roll_no}`).eq('status', 'calling');
}

function setupRealtime() {
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

    signalingChannel = supabaseClient.channel(`signaling:${currentUser.roll_no}`);
    signalingChannel.on('broadcast', { event: 'signal' }, payload => handleSignalingMessage(payload.payload)).subscribe();
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
        await createPeerConnection(targetRoll);
        const offer = await peerConnection.createOffer();
        await peerConnection.setLocalDescription(offer);
        sendSignalingMessage({ type: 'offer', offer: offer, to: targetRoll });
    } catch (err) {
        showToast(err.message);
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
}

async function acceptCall() {
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
    await supabaseClient.from('calls').update({ status: 'rejected' }).eq('id', activeCallId);
    showToast("Call declined");
    resetCallUI();
}

async function endCall() {
    await supabaseClient.from('calls').update({ status: 'ended' }).eq('id', activeCallId);
    showToast("Connection terminated");
    resetCallUI();
}

function handleCallUpdate(call) {
    if (call.status === 'accepted') {
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
}

function resetCallUI() {
    if (peerConnection) { peerConnection.close(); peerConnection = null; }
    if (localStream) { localStream.getTracks().forEach(t => t.stop()); localStream = null; }
    document.getElementById('initial-ui').classList.remove('hidden');
    document.getElementById('active-call-ui').classList.add('hidden');
    const modal = document.getElementById('incoming-call-modal');
    modal.classList.remove('active');
    setTimeout(() => modal.style.display = 'none', 500);
    activeCallId = null;
    clearInterval(callTimerInterval);
    document.getElementById('call-timer').innerText = '00:00';
}

function startTimer() {
    let s = 0;
    clearInterval(callTimerInterval);
    callTimerInterval = setInterval(() => {
        s++;
        document.getElementById('call-timer').innerText = `${Math.floor(s / 60).toString().padStart(2, '0')}:${(s % 60).toString().padStart(2, '0')}`;
    }, 1000);
}

async function logout() {
    if (currentUser) await supabaseClient.from('users').update({ online: false }).eq('roll_no', currentUser.roll_no);
    localStorage.removeItem('user');
    window.location.href = 'index.html';
}
