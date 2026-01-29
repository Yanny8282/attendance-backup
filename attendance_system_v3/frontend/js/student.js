const API_BASE_URL = '/api';
let videoStream = null;
let myClassId = null;
let chatInterval = null;
let myChart = null; 
let checkInInterval = null; 
let cachedLocation = null;

// ★「首振り（向き）」判定用変数
let livenessState = 0; // 0:正面確認, 1:指示待ち/動作確認, 2:完了
let targetDirection = ''; // 'left' or 'right'

// 位置情報の有効期限 (10分)
const LOCATION_VALID_DURATION = 10 * 60 * 1000;

const checkAuth = () => {
    const sid = sessionStorage.getItem('user_id');
    if (!sid || sessionStorage.getItem('user_role') !== 'student') { 
        location.replace('../html/index.html'); 
        return false;
    }
    return true;
};

window.addEventListener('pageshow', (event) => { checkAuth(); });

document.addEventListener('DOMContentLoaded', async () => {
    if (!checkAuth()) return;

    const sid = sessionStorage.getItem('user_id');
    document.getElementById('studentId').textContent = sid;
    
    initLocationCheck();

    const unread = sessionStorage.getItem('unread_count');
    if (unread && parseInt(unread) > 0) {
        alert(`🔔 新着メッセージが ${unread} 件あります`);
        sessionStorage.removeItem('unread_count');
    }

    setupTabs();
    setupHamburgerMenu();
    setupEvents(sid);
    await loadStudentInfo(sid);
    initializeDropdowns();
    
    const now = new Date();
    const currentMonthStr = `${now.getFullYear()}-${('0'+(now.getMonth()+1)).slice(-2)}`;
    document.getElementById('studentScheduleMonth').value = currentMonthStr;
    const calMonthInput = document.getElementById('recordCalendarMonth');
    if(calMonthInput) calMonthInput.value = currentMonthStr;

    loadMySchedule();
    
    try {
        await faceapi.nets.ssdMobilenetv1.loadFromUri('../models');
        await faceapi.nets.faceLandmark68Net.loadFromUri('../models');
        await faceapi.nets.faceRecognitionNet.loadFromUri('../models');
        console.log("AI Models Loaded");
    } catch(e) {
        console.error("AI Model Error:", e);
        alert("AIモデルの読み込みに失敗しました。ページの再読み込みを試してください。");
    }
});

async function initLocationCheck() {
    if (!navigator.geolocation) {
        console.error("Geolocation not supported");
        return;
    }
    navigator.geolocation.getCurrentPosition(async (pos) => {
        const lat = pos.coords.latitude;
        const lng = pos.coords.longitude;
        try {
            const res = await fetch(`${API_BASE_URL}/validate_location`, {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({ lat: lat, lng: lng })
            });
            const d = await res.json();
            if (d.success && d.in_range) {
                cachedLocation = { lat: lat, lng: lng, timestamp: Date.now() };
                console.log("Location Verified:", cachedLocation);
            } else {
                console.warn("Location check failed:", d.message);
                cachedLocation = null;
            }
        } catch(e) { console.error("Location check error:", e); }
    }, (err) => { console.error("GPS Error:", err); });
}

function setupHamburgerMenu() {
    const hamburger = document.getElementById('hamburgerMenu');
    const sideNav = document.getElementById('sideNav');
    const overlay = document.getElementById('navOverlay');
    const toggle = () => {
        sideNav.classList.toggle('open');
        overlay.classList.toggle('show');
    };
    if(hamburger) hamburger.addEventListener('click', toggle);
    if(overlay) overlay.addEventListener('click', toggle);
}

function setupTabs() {
    const sideNav = document.getElementById('sideNav');
    const overlay = document.getElementById('navOverlay');

    document.querySelectorAll('.tab-button').forEach(btn => {
        btn.addEventListener('click', () => {
            if(sideNav) sideNav.classList.remove('open');
            if(overlay) overlay.classList.remove('show');

            document.querySelectorAll('.tab-button').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            document.querySelectorAll('.tab-content').forEach(c => c.style.display = 'none');
            const targetContent = document.getElementById(btn.dataset.tab);
            if(targetContent) targetContent.style.display = 'block';
            
            stopCamera();
            if(chatInterval) clearInterval(chatInterval);
            if(checkInInterval) clearInterval(checkInInterval);

            if(btn.dataset.tab === 'checkin') { 
                startCamera('videoCheckin'); 
                autoSelectCourse(); 
            }
            if(btn.dataset.tab === 'register-face') { startCamera('videoRegister'); }
            if(btn.dataset.tab === 'chat') { loadTeacherList(); startChatPolling(); }
            if(btn.dataset.tab === 'schedule-view') { loadMySchedule(); }
            if(btn.dataset.tab === 'records') { 
                loadRecordCalendar(); 
                loadStudentStats(); 
            } 
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
    if (!faceapi.nets.ssdMobilenetv1.params) return null;
    if (video.paused || video.ended || !video.srcObject) return null;
    
    const detection = await faceapi.detectSingleFace(video).withFaceLandmarks().withFaceDescriptor();
    if (!detection) return null;
    return Array.from(detection.descriptor); 
}

// 顔の向き（Yaw）を簡易計算
// 戻り値: { dir: 'left'|'right'|'center', ratio: number }
function getFaceDirection(landmarks) {
    const nose = landmarks.positions[30];
    const jawLeft = landmarks.positions[0];
    const jawRight = landmarks.positions[16];

    const faceWidth = Math.abs(jawRight.x - jawLeft.x);
    const noseToLeft = Math.abs(nose.x - jawLeft.x);
    const ratio = noseToLeft / faceWidth;

    // ★修正: 閾値をさらに厳しく変更 (0.2, 0.8)
    if (ratio < 0.20) return { dir: 'right', ratio: ratio };
    if (ratio > 0.80) return { dir: 'left', ratio: ratio };
    
    return { dir: 'center', ratio: ratio };
}

async function autoSelectCourse() {
    if(!myClassId) return;
    const sid = sessionStorage.getItem('user_id');

    const btn = document.getElementById('checkInButton');
    const msgEl = document.getElementById('checkinMessage');
    if(msgEl) msgEl.style.display = 'none';
    btn.disabled = true;
    btn.textContent = '確認中...';
    btn.style.backgroundColor = ""; 

    try {
        const res = await fetch(`${API_BASE_URL}/get_today_schedule?class_id=${myClassId}`);
        const d = await res.json();
        const now = new Date();
        const min = now.getHours() * 60 + now.getMinutes();
        let tk = 0;
        
        if (min >= 545 && min < 645) tk = 1;
        else if (min >= 655 && min < 750) tk = 2;
        else if (min >= 805 && min < 900) tk = 3;
        else if (min >= 910 && min < 1005) tk = 4;
        
        const info = document.getElementById('autoSelectInfo');
        const displayKoma = document.getElementById('komaDisplayCheckin');
        const hiddenKoma = document.getElementById('currentKomaId');
        const displayCourse = document.getElementById('courseDisplayCheckin');
        const hiddenCourse = document.getElementById('currentCourseId');
        
        if (tk > 0) {
            const item = d.schedule.find(s => s.koma === tk);
            displayKoma.value = tk + '限'; hiddenKoma.value = tk;
            
            if (item) {
                hiddenCourse.value = item.course_id; 
                displayCourse.value = item.course_name;
                info.textContent = `📅 現在: ${tk}限 ${item.course_name}`;

                const today = new Date().toISOString().split('T')[0];
                const recRes = await fetch(`${API_BASE_URL}/get_student_attendance_range?student_id=${sid}&start_date=${today}&end_date=${today}`);
                const recData = await recRes.json();
                
                let isAlreadyDone = false;
                if (recData.success) {
                    const done = recData.records.find(r => r.koma == tk);
                    if (done) {
                        isAlreadyDone = true;
                        btn.disabled = true;
                        btn.textContent = `登録済 (${done.status_text})`;
                        btn.style.backgroundColor = "#6c757d"; 
                        if(msgEl) {
                            msgEl.style.display = 'block';
                            msgEl.style.color = '#333';
                            msgEl.innerHTML = `✅ このコマは既に <b>${done.status_text}</b> で登録されています。<br>（${done.course_name}）`;
                        }
                        if(checkInInterval) clearInterval(checkInInterval);
                    }
                }

                if (!isAlreadyDone) {
                     btn.textContent = '出席する'; 
                     // 首振りチェック開始
                     livenessState = 0;
                     startHeadTurnCheck(); 
                }

            } else {
                hiddenCourse.value = ''; displayCourse.value = '(授業なし)';
                info.textContent = `⚠️ ${tk}限 授業なし`;
                btn.textContent = '授業なし';
            }
        } else {
            displayKoma.value = '-'; hiddenKoma.value = ''; displayCourse.value = '-'; hiddenCourse.value = '';
            info.textContent = "⚠️ 現在は打刻時間外です";
            btn.textContent = '時間外';
        }
    } catch(e) { console.error(e); }
}

// 首振り検知ロジック
function startHeadTurnCheck() {
    const video = document.getElementById('videoCheckin');
    const msgEl = document.getElementById('checkinMessage'); 
    const btn = document.getElementById('checkInButton');
    
    livenessState = 0; 
    btn.disabled = true;
    
    if (msgEl) {
        msgEl.style.display = 'block';
        msgEl.style.color = '#333';
        msgEl.textContent = "AI準備中...";
    }

    if(checkInInterval) clearInterval(checkInInterval);

    checkInInterval = setInterval(async () => {
        if (!faceapi.nets.faceLandmark68Net.params || video.paused || video.ended) return;
        
        const detection = await faceapi.detectSingleFace(video).withFaceLandmarks();
        
        if (detection) {
            const result = getFaceDirection(detection.landmarks);
            const currentDir = result.dir;
            const currentRatio = result.ratio.toFixed(2);

            // ▼ Step 1: まず正面を向く
            if (livenessState === 0) {
                if(msgEl) {
                    msgEl.textContent = `😐 正面を見てください (現在: ${currentRatio})`;
                    msgEl.style.color = "#333";
                }
                
                if (currentDir === 'center') {
                    livenessState = 1;
                    targetDirection = Math.random() < 0.5 ? 'right' : 'left';
                }
            }
            // ▼ Step 2: 指定された方向を向く
            else if (livenessState === 1) {
                const dirText = targetDirection === 'right' ? '👉 右' : '👈 左';
                const targetVal = targetDirection === 'right' ? '0.2以下' : '0.8以上';

                if(msgEl) {
                    msgEl.textContent = `${dirText} を向いて！ (${currentRatio} → ${targetVal})`;
                    msgEl.style.color = "#e83e8c"; 
                    msgEl.style.fontWeight = "bold";
                }

                if (currentDir === targetDirection) {
                    livenessState = 2; // 完了
                }
            }
            // ▼ 完了
            else if (livenessState === 2) {
                if(msgEl) {
                    msgEl.textContent = "✅ 生体確認OK！出席ボタンを押してください";
                    msgEl.style.color = "green";
                }
                if (btn.disabled) {
                    const koma = document.getElementById('currentKomaId').value;
                    if (koma) btn.disabled = false;
                }
            }

        } else {
            if(msgEl) {
                msgEl.textContent = "❌ 顔が見つかりません";
                msgEl.style.color = "red";
            }
            btn.disabled = true;
            livenessState = 0; // リセット
        }
    }, 200); 
}

function setupEvents(sid) {
    document.getElementById('logoutButton').onclick = () => {
        if(confirm("ログアウトしますか？")) {
            sessionStorage.clear();
            location.replace('../html/index.html');
        }
    };
    document.getElementById('registerFaceButton').onclick = async () => {
        const btn = document.getElementById('registerFaceButton');
        btn.disabled = true;
        btn.textContent = '登録処理中...';
        try {
            const descriptor = await getFaceDescriptor('videoRegister');
            if (!descriptor) { 
                alert("顔が検出されません。カメラを見てください。"); 
                btn.disabled = false; 
                btn.textContent = '登録';
                return; 
            }
            const res = await fetch(`${API_BASE_URL}/register_face`, {
                method: 'POST', headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({ student_id: sid, descriptor: descriptor })
            });
            const d = await res.json();
            
            if (d.success) {
                alert("登録が完了しました！");
            } else {
                alert("登録エラー: " + d.message);
            }
        } catch(e) {
            console.error(e); alert("通信エラーが発生しました: " + e);
        } finally {
            btn.disabled = false;
            btn.textContent = '登録';
        }
    };

    document.getElementById('checkInButton').onclick = async () => {
        const btn = document.getElementById('checkInButton');
        const msg = document.getElementById('checkinMessage');
        const cid = document.getElementById('currentCourseId').value;
        const koma = document.getElementById('currentKomaId').value;
        
        if(msg) msg.style.display = 'block';
        btn.disabled = true;
        btn.textContent = '処理中...';

        if (!cid) { 
            msg.textContent = "⚠️ 現在の時間は授業が設定されていません"; 
            btn.disabled = false; btn.textContent = '出席する'; return; 
        }
        if (!koma) { 
            msg.textContent = "⚠️ 現在は打刻可能な時間帯ではありません"; 
            btn.disabled = false; btn.textContent = '出席する'; return; 
        }

        if (!cachedLocation) {
            msg.textContent = "⚠️ 位置情報が取得できていません。";
            alert("位置情報が確認できませんでした。\n学校の範囲内にいることを確認し、再読み込みしてください。");
            btn.disabled = false; btn.textContent = '出席する'; return;
        }

        const timeDiff = Date.now() - cachedLocation.timestamp;
        if (timeDiff > LOCATION_VALID_DURATION) {
            msg.textContent = "⚠️ 位置情報の有効期限切れです。";
            alert("位置情報の取得から時間が経過しすぎています。\n再読み込みして、最新の位置情報を取得してください。");
            cachedLocation = null;
            initLocationCheck();
            btn.disabled = false; btn.textContent = '出席する'; return;
        }

        if(msg) msg.textContent = "登録状況を確認中...";
        try {
            const today = new Date().toISOString().split('T')[0];
            const checkRes = await fetch(`${API_BASE_URL}/get_student_attendance_range?student_id=${sid}&start_date=${today}&end_date=${today}`);
            const checkData = await checkRes.json();
            
            if (checkData.success) {
                const duplicate = checkData.records.find(r => r.koma == koma);
                if (duplicate) {
                    const statusText = duplicate.status_text || '登録済';
                    const courseName = duplicate.course_name || '不明な授業';
                    msg.textContent = `⚠️ このコマは既に「${statusText}」です`;
                    alert(`このコマ(${koma}限)は既に登録済みです。\n(${courseName} で ${statusText})`);
                    btn.disabled = false; btn.textContent = '出席する'; return; 
                }
            }
        } catch(e) { console.error("Duplicate check error:", e); }

        try {
            if(msg) msg.textContent = "顔解析中...";
            const descriptor = await getFaceDescriptor('videoCheckin');
            if (!descriptor) { 
                msg.textContent = "❌ 顔が見つかりません"; 
                alert("顔が見つかりません。カメラの正面に立ってください。");
                btn.disabled = false; btn.textContent = '出席する'; return; 
            }

            const res = await fetch(`${API_BASE_URL}/check_in`, {
                method: 'POST', headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({
                    student_id: sid, descriptor: descriptor,
                    course_id: cid, koma: koma,
                    lat: cachedLocation.lat, lng: cachedLocation.lng  
                })
            });
            const ret = await res.json();
            
            if (ret.success) {
                msg.textContent = `✅ ${ret.message}`;
                alert(ret.message);
                loadStudentStats();
                if(checkInInterval) clearInterval(checkInInterval);
                btn.disabled = true;
                btn.textContent = '登録完了';
                btn.style.backgroundColor = "#28a745";
            } else {
                msg.textContent = `❌ ${ret.message}`;
                btn.disabled = false;
                btn.textContent = '出席する';
            }
        } catch(e) { 
            console.error(e); msg.textContent = "通信または処理エラー"; 
            btn.disabled = false; btn.textContent = '出席する';
        } 
    };

    document.getElementById('submitAbsenceButton').onclick = async () => {
        const btn = document.getElementById('submitAbsenceButton');
        const date = document.getElementById('absenceDate').value;
        const reason = document.getElementById('absenceReason').value;
        const selects = document.querySelectorAll('.absence-status-select');
        const reports = [];
        selects.forEach(sel => { if (sel.value) reports.push({ koma: parseInt(sel.dataset.koma), status: parseInt(sel.value) }); });
        
        if(!date) { alert("日付を選択してください"); return; }
        if(reports.length === 0) { alert("連絡するコマの状態を1つ以上選択してください"); return; }
        if(!reason) { alert("理由を入力してください"); return; }

        btn.disabled = true;
        btn.textContent = '送信中...';

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
        } finally {
            btn.disabled = false;
            btn.textContent = '送信する';
        }
    };

    document.getElementById('sendChatButton').onclick = async () => {
        const btn = document.getElementById('sendChatButton');
        const txt = document.getElementById('chatInput').value.trim();
        const tid = document.getElementById('chatTeacherSelect').value;
        if(!txt || !tid) return;
        
        btn.disabled = true; 
        try {
            await fetch(`${API_BASE_URL}/chat/send`, {
                method: 'POST', headers: {'Content-Type':'application/json'},
                body: JSON.stringify({sender_id: sid, receiver_id: tid, content: txt})
            });
            document.getElementById('chatInput').value = '';
            loadChatHistory();
        } catch(e) { console.error(e); alert("送信エラー"); } finally { btn.disabled = false; }
    };

    document.getElementById('chatTeacherSelect').onchange = loadChatHistory;
    document.getElementById('studentScheduleMonth').onchange = loadMySchedule;
    document.getElementById('recordCalendarMonth').onchange = loadRecordCalendar;
    document.getElementById('refreshRecordsBtn').onclick = loadRecordCalendar;
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
        document.getElementById('absenceDate').value = new Date().toISOString().split('T')[0];
    } catch(e) {}
}

async function loadMySchedule() {
    if(!myClassId) return;
    const val = document.getElementById('studentScheduleMonth').value;
    if(!val) return;
    const ym = val.split('-');
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

async function loadRecordCalendar() {
    const sid = sessionStorage.getItem('user_id');
    const val = document.getElementById('recordCalendarMonth').value;
    if(!val) return;
    
    const ym = val.split('-');
    const year = parseInt(ym[0]);
    const month = parseInt(ym[1]);
    const start = new Date(year, month - 1, 1);
    const end = new Date(year, month, 0);
    const format = (d) => `${d.getFullYear()}-${(d.getMonth()+1).toString().padStart(2,'0')}-${d.getDate().toString().padStart(2,'0')}`;
    const s_str = format(start);
    const e_str = format(end);

    const url = `${API_BASE_URL}/get_student_attendance_range?student_id=${sid}&start_date=${s_str}&end_date=${e_str}`;
    const res = await (await fetch(url)).json();
    
    let h = '<div class="month-calendar">';
    ['日','月','火','水','木','金','土'].forEach(x => h += `<div class="month-day-header">${x}</div>`);
    for(let i=0; i<start.getDay(); i++) h += '<div></div>';

    let loopDate = new Date(start);
    while(loopDate <= end) {
        const dt = format(loopDate);
        const dayNum = loopDate.getDate();
        let b = '';
        const todayRecs = res.records.filter(r => r.attendance_date === dt);
        todayRecs.sort((a,b) => a.koma - b.koma);
        todayRecs.forEach(r => {
            let c = '';
            if(r.status_id == 1) c = 'bg-present';
            else if(r.status_id == 2) c = 'bg-late';
            else if(r.status_id == 3) c = 'bg-absent';
            else c = 'bg-late'; 
            b += `<div class="mini-badge ${c}">${r.koma}:${r.status_text}</div>`;
        });
        h += `<div class="month-day" style="min-height:80px;"><div class="day-number">${dayNum}</div>${b}</div>`;
        loopDate.setDate(loopDate.getDate() + 1);
    }
    document.getElementById('recordCalendarContainer').innerHTML = h + '</div>';
}

async function loadStudentStats() {
    const sid = sessionStorage.getItem('user_id');
    try {
        const res = await fetch(`${API_BASE_URL}/get_student_stats?student_id=${sid}`);
        const d = await res.json();
        
        if (d.success) {
            document.getElementById('attendanceRate').textContent = d.rate;
            document.getElementById('totalClasses').textContent = d.total_classes;
            
            const ctx = document.getElementById('attendanceChart').getContext('2d');
            if (myChart) myChart.destroy();

            myChart = new Chart(ctx, {
                type: 'doughnut', 
                data: {
                    labels: ['出席', '遅刻', '欠席', '早退'],
                    datasets: [{
                        data: [d.counts[1], d.counts[2], d.counts[3], d.counts[4]],
                        backgroundColor: ['#28a745', '#fd7e14', '#dc3545', '#17a2b8']
                    }]
                },
                options: {
                    responsive: true,
                    plugins: { legend: { position: 'bottom' } }
                }
            });
        }
    } catch(e) { console.error(e); }
}

async function loadTeacherList() {
    const el = document.getElementById('chatTeacherSelect');
    if(el.options.length>0) return;
    const res = await fetch(`${API_BASE_URL}/get_teacher_list`);
    const d = await res.json();
    el.innerHTML = '';
    d.teachers.forEach(t => {
        if (t.teacher_id === 'admin' || t.is_admin === 1) return;
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