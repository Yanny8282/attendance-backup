// ★変更: HTTPS化に伴い、相対パスに変更
const API_BASE_URL = '/api';
let videoStream = null;
let myClassId = null;
let chatInterval = null;

document.addEventListener('DOMContentLoaded', async () => {
    const sid = sessionStorage.getItem('user_id');
    if (!sid || sessionStorage.getItem('user_role') !== 'student') { 
        alert('認証エラー'); location.href = 'index.html'; return; 
    }
    document.getElementById('studentId').textContent = sid;
    
    const unread = sessionStorage.getItem('unread_count');
    if (unread && parseInt(unread) > 0) {
        alert(`🔔 新着メッセージが ${unread} 件あります`);
        sessionStorage.removeItem('unread_count');
    }

    setupTabs();
    setupEvents(sid);
    await loadStudentInfo(sid);
    initializeDropdowns();
    
    const now = new Date();
    document.getElementById('studentScheduleMonth').value = `${now.getFullYear()}-${('0'+(now.getMonth()+1)).slice(-2)}`;
    loadMySchedule();

    if (location.hostname !== 'localhost' && location.hostname !== '127.0.0.1' && location.protocol !== 'https:') {
        const warning = document.createElement('div');
        warning.style.background = '#ffeb3b';
        warning.style.padding = '10px';
        warning.style.textAlign = 'center';
        warning.style.fontSize = '0.8rem';
        warning.innerHTML = '⚠️ 注意: スマホ等の別端末からHTTPでアクセスしている場合、<b>カメラやGPSが機能しない</b>ことがあります。';
        document.querySelector('.container').prepend(warning);
    }

    console.log("Loading AI Models...");
    try {
        await faceapi.nets.ssdMobilenetv1.loadFromUri('../models');
        await faceapi.nets.faceLandmark68Net.loadFromUri('../models');
        await faceapi.nets.faceRecognitionNet.loadFromUri('../models');
        console.log("AI Models Loaded");
    } catch(e) {
        console.error("AI Model Error:", e);
    }
});

function setupTabs() {
    document.querySelectorAll('.tab-button').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.tab-button').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            document.querySelectorAll('.tab-content').forEach(c => c.style.display = 'none');
            document.getElementById(btn.dataset.tab).style.display = 'block';
            
            stopCamera();
            if(chatInterval) clearInterval(chatInterval);

            if(btn.dataset.tab === 'checkin') { startCamera('videoCheckin'); autoSelectCourse(); }
            if(btn.dataset.tab === 'register-face') { startCamera('videoRegister'); }
            if(btn.dataset.tab === 'chat') { loadTeacherList(); startChatPolling(); }
            if(btn.dataset.tab === 'schedule-view') { loadMySchedule(); }
            if(btn.dataset.tab === 'records') { loadRecords(); }
        });
    });
}

async function startCamera(vidId) {
    const video = document.getElementById(vidId);
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        alert("お使いのブラウザまたは接続環境ではカメラを使用できません。(HTTPS接続が必要です)");
        return;
    }
    try {
        videoStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' } });
        video.srcObject = videoStream;
    } catch(e) { 
        console.error(e); 
        alert("カメラの起動に失敗しました。許可設定を確認してください。"); 
    }
}

function stopCamera() { 
    if(videoStream) { videoStream.getTracks().forEach(t=>t.stop()); videoStream=null; } 
}

async function getFaceDescriptor(vidId) {
    const video = document.getElementById(vidId);
    if (!faceapi.nets.ssdMobilenetv1.params || video.paused || video.ended || !video.srcObject) return null;
    const detection = await faceapi.detectSingleFace(video).withFaceLandmarks().withFaceDescriptor();
    if (!detection) return null;
    return Array.from(detection.descriptor); 
}

function setupEvents(sid) {
    document.getElementById('logoutButton').onclick = () => { sessionStorage.clear(); location.href = '../html/index.html'; };

    document.getElementById('registerFaceButton').onclick = async () => {
        const btn = document.getElementById('registerFaceButton');
        btn.disabled = true;
        try {
            const descriptor = await getFaceDescriptor('videoRegister');
            if (!descriptor) { alert("顔が検出されません。カメラを見てください。"); btn.disabled = false; return; }
            await fetch(`${API_BASE_URL}/register_face`, {
                method: 'POST', headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({ student_id: sid, descriptor: descriptor })
            });
            alert("登録完了");
        } catch(e) {
            console.error(e); alert("エラーが発生しました");
        } finally {
            btn.disabled = false;
        }
    };

    document.getElementById('checkInButton').onclick = async () => {
        const btn = document.getElementById('checkInButton');
        const msg = document.getElementById('checkinMessage');
        const cid = document.getElementById('courseSelectCheckin').value;
        const koma = document.getElementById('komaSelectCheckin').value;
        
        msg.style.display = 'block';
        msg.textContent = "位置情報取得中..."; 
        btn.disabled = true;

        if (!navigator.geolocation) {
            msg.textContent = "⚠️ この端末では位置情報が使えません";
            btn.disabled = false;
            return;
        }

        // ★変更: タイムアウト対策のため設定を緩和
        navigator.geolocation.getCurrentPosition(async (pos) => {
            try {
                msg.textContent = "顔解析中...";
                const descriptor = await getFaceDescriptor('videoCheckin');
                if (!descriptor) { 
                    msg.textContent = "❌ 顔が見つかりません"; 
                    alert("顔が見つかりません。カメラの正面に立ってください。");
                    btn.disabled = false; 
                    return; 
                }

                const res = await fetch(`${API_BASE_URL}/check_in`, {
                    method: 'POST', headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify({
                        student_id: sid, descriptor: descriptor,
                        course_id: cid, koma: koma,
                        lat: pos.coords.latitude, lng: pos.coords.longitude
                    })
                });
                const ret = await res.json();
                msg.textContent = ret.success ? `✅ ${ret.message}` : `❌ ${ret.message}`;
            } catch(e) { 
                console.error(e);
                msg.textContent = "通信または処理エラー"; 
            } finally {
                btn.disabled = false;
            }
        }, (err) => { 
            console.error(err);
            let errMsg = "GPSエラー";
            if (err.code === 1) errMsg = "⚠️ 位置情報の許可が必要です";
            else if (err.code === 2) errMsg = "⚠️ 位置情報が取得できません";
            else if (err.code === 3) errMsg = "⚠️ タイムアウトしました(再試行してください)";
            
            msg.textContent = errMsg; 
            btn.disabled = false; 
        }, {
            enableHighAccuracy: false, // ★変更: trueだと室内で失敗しやすいためfalseに変更
            timeout: 30000,            // ★変更: 待ち時間を30秒に延長
            maximumAge: 0
        });
    };

    document.getElementById('submitAbsenceButton').onclick = async () => {
        const date = document.getElementById('absenceDate').value;
        const reason = document.getElementById('absenceReason').value;
        const selects = document.querySelectorAll('.absence-status-select');
        const reports = [];
        selects.forEach(sel => {
            if (sel.value) { 
                reports.push({ koma: parseInt(sel.dataset.koma), status: parseInt(sel.value) });
            }
        });
        
        if(!date) { alert("日付を選択してください"); return; }
        if(reports.length === 0) { alert("連絡するコマの状態を1つ以上選択してください"); return; }
        if(!reason) { alert("理由を入力してください"); return; }

        try {
            const res = await fetch(`${API_BASE_URL}/report_absence`, {
                method: 'POST', headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({ student_id: sid, absence_date: date, reports: reports, reason: reason })
            });
            const ret = await res.json();
            if(ret.success) {
                alert(`送信完了 (${ret.count}件の連絡を登録しました)`);
                selects.forEach(s => s.value = "");
                document.getElementById('absenceReason').value = '';
            } else {
                alert("送信失敗: " + ret.message);
            }
        } catch(e) {
            console.error(e); alert("通信エラー");
        }
    };

    document.getElementById('sendChatButton').onclick = async () => {
        const txt = document.getElementById('chatInput').value;
        const tid = document.getElementById('chatTeacherSelect').value;
        if(!txt || !tid) return;
        await fetch(`${API_BASE_URL}/chat/send`, {
            method: 'POST', headers: {'Content-Type':'application/json'},
            body: JSON.stringify({sender_id: sid, receiver_id: tid, content: txt})
        });
        document.getElementById('chatInput').value = '';
        loadChatHistory();
    };
    document.getElementById('chatTeacherSelect').onchange = loadChatHistory;
    document.getElementById('studentScheduleMonth').onchange = loadMySchedule;
}

async function loadStudentInfo(id) {
    try {
        const res = await fetch(`${API_BASE_URL}/get_student_info?student_id=${id}`);
        const d = await res.json();
        if(d.success) { 
            document.getElementById('studentName').textContent = d.student.student_name;
            myClassId = d.student.class_id;
        }
    } catch(e) { console.error("Login Check Error", e); }
}
async function initializeDropdowns() {
    try {
        const res = await fetch(`${API_BASE_URL}/get_course_koma`);
        const d = await res.json();
        const set = (id, list, k, v) => {
            const el = document.getElementById(id); if(!el) return;
            el.innerHTML = '';
            list.forEach(i => { const o = document.createElement('option'); o.value=i[k]; o.textContent=i[v]; el.appendChild(o); });
        };
        set('courseSelectCheckin', d.courses, 'course_id', 'course_name');
        set('komaSelectCheckin', d.komas, 'koma_id', 'koma_name');
        document.getElementById('absenceDate').value = new Date().toISOString().split('T')[0];
    } catch(e) {}
}

async function autoSelectCourse() {
    if(!myClassId) return;
    try {
        const res = await fetch(`${API_BASE_URL}/get_today_schedule?class_id=${myClassId}`);
        const d = await res.json();
        const now = new Date();
        const min = now.getHours() * 60 + now.getMinutes();
        let tk = 0;
        if (min >= 530 && min < 650) tk = 1;
        else if (min >= 650 && min < 800) tk = 2;
        else if (min >= 800 && min < 905) tk = 3;
        else if (min >= 905 && min < 1020) tk = 4;
        
        const info = document.getElementById('autoSelectInfo');
        if (tk > 0) {
            const item = d.schedule.find(s => s.koma === tk);
            if (item) {
                document.getElementById('courseSelectCheckin').value = item.course_id;
                document.getElementById('komaSelectCheckin').value = tk;
                info.textContent = `📅 自動選択: ${tk}限 ${item.course_name}`;
            } else info.textContent = `⚠️ ${tk}限 授業なし`;
        } else info.textContent = "⚠️ 授業時間外";
    } catch(e) {}
}

async function loadMySchedule() {
    if(!myClassId) return;
    const ym = document.getElementById('studentScheduleMonth').value.split('-');
    const res = await fetch(`${API_BASE_URL}/get_monthly_schedule?class_id=${myClassId}&year=${ym[0]}&month=${ym[1]}`);
    const d = await res.json();
    const con = document.getElementById('scheduleContainer');
    let h = '<div class="month-calendar">';
    ['日','月','火','水','木','金','土'].forEach(x=>h+=`<div class="month-day-header">${x}</div>`);
    const start = new Date(ym[0], ym[1]-1, 1);
    const end = new Date(ym[0], ym[1], 0);
    for(let i=0; i<start.getDay(); i++) h+='<div></div>';
    for(let i=1; i<=end.getDate(); i++) {
        const date = `${ym[0]}-${ym[1].toString().padStart(2,'0')}-${i.toString().padStart(2,'0')}`;
        let evs = '';
        d.schedule.filter(s=>s.schedule_date===date).forEach(s=>{
            evs +=`<div class="mini-badge">${s.koma}:${s.course_name}</div>`;
        });
        h+=`<div class="month-day"><div class="day-number">${i}</div>${evs}</div>`;
    }
    con.innerHTML = h+'</div>';
}

async function loadRecords() {
    const res = await fetch(`${API_BASE_URL}/student_records?student_id=${sessionStorage.getItem('user_id')}`);
    const d = await res.json();
    const tb = document.querySelector('#attendanceTable tbody');
    tb.innerHTML = '';
    d.records.forEach(r => {
        tb.innerHTML += `<tr><td>${r.attendance_date}</td><td>${r.koma}</td><td>${r.course_name}</td><td>${r.attendance_status}</td><td>${r.attendance_time||'-'}</td></tr>`;
    });
}

async function loadTeacherList() {
    const el = document.getElementById('chatTeacherSelect');
    if(el.options.length>0) return;
    const res = await fetch(`${API_BASE_URL}/get_teacher_list`);
    const d = await res.json();
    el.innerHTML = '';
    d.teachers.forEach(t => {
        const o = document.createElement('option'); o.value=t.teacher_id; o.textContent=t.teacher_name; el.appendChild(o);
    });
    loadChatHistory();
}
async function loadChatHistory() {
    const tid = document.getElementById('chatTeacherSelect').value;
    const my = sessionStorage.getItem('user_id');
    if(!tid) return;
    const res = await fetch(`${API_BASE_URL}/chat/history?user1=${my}&user2=${tid}`);
    const d = await res.json();
    const w = document.getElementById('chatWindow');
    w.innerHTML = '';
    d.messages.forEach(m => {
        w.innerHTML += `<div class="message-bubble ${m.sender_id==my?'mine':'theirs'}"><div>${m.message_content}</div><div class="message-time">${m.time}</div></div>`;
    });
    w.scrollTop = w.scrollHeight;
}
function startChatPolling() {
    loadChatHistory();
    if(chatInterval) clearInterval(chatInterval);
    chatInterval = setInterval(loadChatHistory, 3000);
}