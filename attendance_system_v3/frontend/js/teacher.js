const API_BASE_URL = '/api';
let courses = [], komas = [], students = [], teachers = [], schSel = [], chatTimer = null;
let editStData = null, editSchData = null, allClassIds = [];
// ★追加: 選択された「コマ」を保存する配列
let schSelKomas = [];

// ==========================================
// ▼ 認証チェック関数
// ==========================================
const checkAuth = () => {
    const tid = sessionStorage.getItem('user_id');
    const role = sessionStorage.getItem('user_role');
    
    // 'teacher' または 'admin' 以外はリダイレクト
    if (!tid || (role !== 'teacher' && role !== 'admin')) {
        location.replace('../html/index.html');
        return false;
    }
    
    // 一般教員の場合、教員管理タブを非表示
    if (role === 'teacher') {
        const adminTab = document.getElementById('tab-btn-teacher-crud');
        if (adminTab) adminTab.style.display = 'none';
    }
    return true;
};

window.addEventListener('pageshow', (event) => {
    checkAuth();
});

// ==========================================
// ▼ 初期化処理
// ==========================================
document.addEventListener('DOMContentLoaded', async () => {
    if (!checkAuth()) return;

    try {
        const tid = sessionStorage.getItem('user_id');
        const elId = document.getElementById('teacherId');
        if(elId) elId.textContent = tid;

        const d = new Date();
        const today = d.toISOString().split('T')[0];
        const ym = `${d.getFullYear()}-${('0'+(d.getMonth()+1)).slice(-2)}`;

        const elDate = document.getElementById('realtimeDate');
        if(elDate) elDate.value = today;

        const elMonth = document.getElementById('scheduleMonthInput');
        if(elMonth) elMonth.value = ym;

        const elCsv = document.getElementById('csvMonthInput');
        if(elCsv) elCsv.value = ym;

        const elBase = document.getElementById('calBaseDate');
        if(elBase) elBase.value = today;

        const elAbsence = document.getElementById('absenceDateFilter');
        if(elAbsence) elAbsence.value = today;

        setupEvents();

        console.log("初期データを読み込み中...");
        await initData();
        
        loadRealtime();

        const u = sessionStorage.getItem('unread_count');
        if (u && parseInt(u) > 0) {
            alert(`🔔 新着メッセージ: ${u}件`);
            sessionStorage.removeItem('unread_count');
        }

    } catch (e) {
        console.error("起動エラー:", e);
    }
});

// ==========================================
// ▼ データ初期化
// ==========================================
async function initData() {
    try {
        const r1 = await fetch(`${API_BASE_URL}/get_course_koma`);
        const d1 = await r1.json();
        courses = d1.courses || [];
        komas = d1.komas || [];

        const r2 = await fetch(`${API_BASE_URL}/get_class_list`);
        const d2 = await r2.json();
        const classList = d2.classes || [];
        allClassIds = classList.map(c => c.class_id);

        const setOptions = (id, list, k, v, emp=false) => {
            const el = document.getElementById(id); 
            if (!el) return;
            el.innerHTML = emp ? '<option value="0">(なし)</option>' : '';
            list.forEach(i => {
                const o = document.createElement('option');
                o.value = i[k];
                o.textContent = i[v];
                el.appendChild(o);
            });
        };

        setOptions('realtimeKoma', komas, 'koma_id', 'koma_name');
        setOptions('schModalCourse', courses, 'course_id', 'course_name', true);
        setOptions('schMultiCourseSelect', courses, 'course_id', 'course_name', true);
        setOptions('stModalCourse', courses, 'course_id', 'course_name');
        setOptions('stModalKoma', komas, 'koma_id', 'koma_name');

        const setClassOptions = (id) => {
            const el = document.getElementById(id);
            if (!el) return;
            classList.forEach(c => {
                if (!el.querySelector(`option[value="${c.class_id}"]`)) {
                    const o = document.createElement('option');
                    o.value = c.class_id;
                    o.textContent = `クラス${c.class_id}`;
                    el.appendChild(o);
                }
            });
        };

        ['realtimeClassFilter', 'scheduleClassSelect', 'calClassFilter', 'absenceClassFilter', 'chatClassFilter', 'studentCrudClassFilter'].forEach(setClassOptions);

        const schEl = document.getElementById('scheduleClassSelect');
        if (schEl && schEl.options.length > 0) schEl.value = schEl.options[0].value;

        const h = new Date().getHours();
        const m = new Date().getMinutes();
        const mm = h * 60 + m;
        let k = 1;
        if (mm >= 645 && mm < 750) k = 2;
        else if (mm >= 805 && mm < 900) k = 3;
        else if (mm >= 910) k = 4;

        const kEl = document.getElementById('realtimeKoma');
        if (kEl) kEl.value = k;

    } catch (e) {
        console.error("データ初期化エラー:", e);
    }
}

// ==========================================
// ▼ イベント設定
// ==========================================
function setupEvents() {
    const logoutBtn = document.getElementById('logoutButton');
    if (logoutBtn) {
        logoutBtn.onclick = () => {
            sessionStorage.clear();
            location.replace('../html/index.html');
        };
    }

    document.querySelectorAll('.tab-button').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.tab-button').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            
            document.querySelectorAll('.tab-content').forEach(c => c.style.display='none');
            const target = document.getElementById(btn.dataset.tab);
            if (target) target.style.display='block';
            
            if (chatTimer) clearInterval(chatTimer);
            
            const t = btn.dataset.tab;
            if (t === 'chat-mgr') { loadChatStudents(); chatTimer = setInterval(loadChatHist, 3000); }
            if (t === 'schedule-mgr') loadSchedule();
            if (t === 'student-attendance') loadCalStudents();
            if (t === 'student-crud') loadStudentList();
            if (t === 'teacher-crud') loadTeacherList();
        });
    });

    const bind = (id, func) => { 
        const el=document.getElementById(id); 
        if(el) el.onclick=func; 
    };

    bind('refreshRealtime', loadRealtime);
    bind('schMultiApplyBtn', applyMultiSch);
    bind('schModalSave', saveSingleSch);
    
    const addCourse = document.getElementById('addCourseMasterBtn');
    if (addCourse) {
        addCourse.onclick = async () => {
            const n = document.getElementById('newCourseName').value;
            if (n) {
                await fetch(`${API_BASE_URL}/add_course_master`, {
                    method: 'POST', headers: {'Content-Type':'application/json'},
                    body: JSON.stringify({course_name:n})
                });
                location.reload();
            }
        };
    }

    bind('showCalendarBtn', loadCalendar);
    bind('stModalSave', saveStatus);
    bind('stModalDelete', deleteStatus); // 削除ボタン
    bind('teacherSendChatButton', sendChat);
    bind('broadcastChatButton', openBroadcast);
    bind('submitBroadcast', sendBroadcast);
    bind('refreshAbsenceReports', loadAbsence);

    const sCls = document.getElementById('scheduleClassSelect');
    if (sCls) sCls.onchange = loadSchedule;
    
    const sMonth = document.getElementById('scheduleMonthInput');
    if (sMonth) sMonth.onchange = loadSchedule;

    document.querySelectorAll('input[name="schMode"]').forEach(e => {
        e.onchange = () => {
            const mc = document.getElementById('multiControls');
            if (mc) mc.style.display = e.value === 'multi' ? 'inline' : 'none';
            // ★変更: モード変更時に選択状態を完全リセット
            schSel = [];
            schSelKomas = [];
            loadSchedule();
        };
    });
    
    const calF = document.getElementById('calClassFilter');
    if (calF) calF.onchange = loadCalStudents;

    const stuF = document.getElementById('studentCrudClassFilter');
    if (stuF) stuF.onchange = loadStudentList;

    const chatF = document.getElementById('chatClassFilter');
    if (chatF) chatF.onchange = loadChatStudents;

    const chatS = document.getElementById('chatStudentSelect');
    if (chatS) chatS.onchange = loadChatHist;
    
    const crudSel = document.getElementById('crudSClassSelect');
    if (crudSel) {
        crudSel.onchange = () => {
            const inp = document.getElementById('crudSClassInput');
            if (inp) inp.style.display = crudSel.value === 'new' ? 'inline-block' : 'none';
        };
    }
}

// ==========================================
// ▼ リアルタイム機能
// ==========================================
async function loadRealtime() {
    try {
        const kEl = document.getElementById('realtimeKoma');
        const dEl = document.getElementById('realtimeDate');
        const cEl = document.getElementById('realtimeClassFilter');

        if (!kEl || !dEl || !cEl) return;

        const url = `${API_BASE_URL}/realtime_status?koma=${kEl.value}&date=${dEl.value}&class_id=${cEl.value}`;
        const res = await fetch(url);
        if (!res.ok) return;

        const d = await res.json();
        const tb = document.querySelector('#realtimeTable tbody');
        if (!tb) return;

        tb.innerHTML = '';
        if (d.records) {
            d.records.forEach(r => {
                const cls = r.attendance_status === '出席' ? 'status-present' : (r.attendance_status === '欠席' ? 'status-absent' : '');
                tb.innerHTML += `<tr>
                    <td>${r.student_id}</td>
                    <td>${r.student_name}</td>
                    <td>${r.class_id || '-'}</td>
                    <td>${r.course_name}</td>
                    <td class="${cls}">${r.attendance_status}</td>
                    <td>${r.time}</td>
                    <td><button onclick="jumpToDetail(${r.student_id},'${r.class_id}')" style="background:#17a2b8;">詳細</button></td>
                </tr>`;
            });
        }
    } catch (e) {
        console.error("Realtime load error:", e);
    }
}

window.jumpToDetail = async (sid, cid) => {
    const btn = document.querySelector('[data-tab="student-attendance"]');
    if (btn) btn.click();

    const sel = document.getElementById('calClassFilter');
    if (sel) {
        let exists = false;
        for (let i = 0; i < sel.options.length; i++) {
            if (sel.options[i].value == cid) exists = true;
        }
        sel.value = exists ? cid : 'all';
    }

    const dEl = document.getElementById('realtimeDate');
    const bEl = document.getElementById('calBaseDate');
    if (dEl && bEl) bEl.value = dEl.value;

    await loadCalStudents();

    const stSel = document.getElementById('calStudentSelect');
    if (stSel) stSel.value = sid;

    loadCalendar();
};

// ==========================================
// ▼ カレンダー機能
// ==========================================
async function loadCalStudents() {
    const el = document.getElementById('calClassFilter');
    if (!el) return;

    const res = await (await fetch(`${API_BASE_URL}/get_student_list?class_id=${el.value}`)).json();
    const s = document.getElementById('calStudentSelect');
    if (!s) return;

    s.innerHTML = '<option value="">選択</option>';
    if (res.students) {
        res.students.forEach(i => {
            s.innerHTML += `<option value="${i.student_id}">${i.student_name}</option>`;
        });
    }
}

async function loadCalendar() {
    const sidEl = document.getElementById('calStudentSelect');
    const sid = sidEl.value;
    if (!sid) { alert("生徒を選択してください"); return; }
    
    const type = document.getElementById('calViewType').value;
    const base = document.getElementById('calBaseDate').value;
    if (!base) return;

    const bDate = new Date(base);
    let sDate, eDate;
    
    if (type === 'month') {
        sDate = new Date(bDate.getFullYear(), bDate.getMonth(), 1);
        eDate = new Date(bDate.getFullYear(), bDate.getMonth() + 1, 0);
    } else {
        const day = bDate.getDay(); 
        const diff = bDate.getDate() - day + (day === 0 ? -6 : 1);
        sDate = new Date(bDate.setDate(diff));
        eDate = new Date(bDate.setDate(diff + 6));
    }

    const fmt = d => `${d.getFullYear()}-${('0'+(d.getMonth()+1)).slice(-2)}-${('0'+d.getDate()).slice(-2)}`;
    const url = `${API_BASE_URL}/get_student_attendance_range?student_id=${sid}&start_date=${fmt(sDate)}&end_date=${fmt(eDate)}`;
    const res = await (await fetch(url)).json();
    
    const con = document.getElementById('calendarContainer');
    con.innerHTML = '';
    
    let html = '<div style="display:flex; flex-wrap:wrap; gap:10px;">';
    let cur = new Date(sDate);
    while (cur <= eDate) {
        const dStr = fmt(cur);
        const dayRecs = res.records ? res.records.filter(r => r.attendance_date === dStr) : [];
        
        let cell = `<div style="border:1px solid #ddd; width:130px; padding:5px; background:${dStr===fmt(new Date())?'#e8f4ff':'white'};">`;
        cell += `<div style="font-weight:bold; border-bottom:1px solid #eee; margin-bottom:5px;">${dStr}</div>`;
        
        if (dayRecs.length > 0) {
            dayRecs.forEach(r => {
                const cls = r.status_id === 1 ? 'status-present' : (r.status_id === 2 ? 'status-late' : (r.status_id === 3 ? 'status-absent' : (r.status_id === 5 ? 'bg-norecord' : 'status-early')));
                cell += `<div class="event-badge ${cls}" onclick="openStatusModal('${r.student_id}','${dStr}',${r.koma},${r.status_id},${r.course_id})">${r.koma}:${r.status_text}</div>`;
            });
        } else {
            cell += `<div style="color:#ccc; font-size:0.8rem;">記録なし</div>`;
            // 空きコマでも追加できるように
            for(let k=1; k<=4; k++) {
                 cell += `<div style="color:#ccc; font-size:0.8rem; cursor:pointer;" onclick="openStatusModal('${sid}','${dStr}',${k},5,0)">[+] ${k}限追加</div>`;
            }
        }
        cell += '</div>';
        html += cell;
        cur.setDate(cur.getDate() + 1);
    }
    con.innerHTML = html + '</div>';
}

window.openStatusModal = (sid, date, koma, status, course) => {
    editStData = { sid, date, koma };
    document.getElementById('stModalInfo').textContent = `${date} ${koma}限 (${sid})`;
    document.getElementById('stModalSelect').value = status;
    document.getElementById('stModalCourse').value = course || (courses.length > 0 ? courses[0].course_id : 0);
    document.getElementById('stModalKoma').value = koma;
    document.getElementById('statusChangeModal').style.display = 'block';
};

async function saveStatus() {
    const st = document.getElementById('stModalSelect').value;
    const cid = document.getElementById('stModalCourse').value;
    const k = document.getElementById('stModalKoma').value;
    
    if (editStData) {
        await fetch(`${API_BASE_URL}/update_attendance_status`, {
            method: 'POST', headers: {'Content-Type':'application/json'},
            body: JSON.stringify({
                student_id: editStData.sid, date: editStData.date, koma: k, status_id: st, course_id: cid
            })
        });
        document.getElementById('statusChangeModal').style.display = 'none';
        loadCalendar();
    }
}

async function deleteStatus() {
    if (editStData && confirm("この記録を削除しますか？")) {
        await fetch(`${API_BASE_URL}/delete_attendance_record`, {
            method: 'POST', headers: {'Content-Type':'application/json'},
            body: JSON.stringify({ student_id: editStData.sid, date: editStData.date, koma: editStData.koma })
        });
        document.getElementById('statusChangeModal').style.display = 'none';
        loadCalendar();
    }
}

window.downloadCsv = async () => {
    const cls = document.getElementById('calClassFilter').value;
    const ym = document.getElementById('csvMonthInput').value; // yyyy-mm
    if (!ym) return;
    const [y, m] = ym.split('-');
    
    const url = `${API_BASE_URL}/download_attendance_csv?class_id=${cls}&year=${y}&month=${m}`;
    window.open(url, '_blank');
};

// ==========================================
// ▼ 時間割管理 (大幅修正部分)
// ==========================================
async function loadSchedule() {
    const cls = document.getElementById('scheduleClassSelect').value;
    const ym = document.getElementById('scheduleMonthInput').value;
    if (!cls || !ym) return;

    const [y, m] = ym.split('-');
    const res = await (await fetch(`${API_BASE_URL}/get_monthly_schedule?class_id=${cls}&year=${y}&month=${m}`)).json();
    const sch = res.schedule || [];

    const con = document.getElementById('scheduleCalendarWrapper');
    let html = '<div class="sch-grid" style="display:grid; grid-template-columns:repeat(7,1fr); gap:5px;">';
    ['日','月','火','水','木','金','土'].forEach(d => html += `<div style="text-align:center; font-weight:bold; background:#eee;">${d}</div>`);

    const sDate = new Date(y, m-1, 1);
    const eDate = new Date(y, m, 0);
    
    for(let i=0; i<sDate.getDay(); i++) html += '<div></div>';

    let cur = new Date(sDate);
    while (cur <= eDate) {
        const dStr = `${cur.getFullYear()}-${('0'+(cur.getMonth()+1)).slice(-2)}-${('0'+cur.getDate()).slice(-2)}`;
        
        // 日付自体の選択状態 (既存)
        const isDaySel = schSel.includes(dStr);
        
        let cell = `<div class="sch-day ${isDaySel?'selected':''}" onclick="toggleSchSelect('${dStr}')" style="border:1px solid #ccc; min-height:80px; padding:5px; position:relative;">`;
        cell += `<div style="font-weight:bold;">${cur.getDate()}</div>`;

        for(let k=1; k<=4; k++) {
            const f = sch.find(x => x.schedule_date === dStr && x.koma == k);
            const cName = f ? f.course_name : '-';
            const cId = f ? f.course_id : 0;

            // ★追加: このコマが選択されているかチェック
            const isKomaSel = schSelKomas.some(item => item.date === dStr && item.koma === k);
            // ★追加: 選択されていたら枠線を赤くしたり背景を変えたりする
            const bgStyle = isKomaSel ? '#ffc107' : (f ? '#d1ecf1' : '#f8f9fa');
            const borderStyle = isKomaSel ? '2px solid #ff0000' : '1px solid #ddd';
            
            // ★変更: onclick を onSchItemClick に投げる
            cell += `<div class="sch-item" onclick="event.stopPropagation(); onSchItemClick('${dStr}', ${k}, ${cId})" style="font-size:0.8rem; background:${bgStyle}; border:${borderStyle}; margin-top:2px; cursor:pointer; padding:2px;">${k}:${cName}</div>`;
        }
        cell += '</div>';
        html += cell;
        cur.setDate(cur.getDate() + 1);
    }
    con.innerHTML = html + '</div>';
}

// ★追加: モードに応じたクリック処理の分岐
window.onSchItemClick = (date, koma, cid) => {
    const mode = document.querySelector('input[name="schMode"]:checked').value;
    if (mode === 'multi') {
        // 一括モードなら選択状態をトグル
        toggleSchKoma(date, koma);
    } else {
        // 個別モードなら編集モーダルを開く（既存動作）
        openSchModal(date, koma, cid);
    }
};

window.toggleSchSelect = (date) => {
    if (document.querySelector('input[name="schMode"]:checked').value !== 'multi') return;
    if (schSel.includes(date)) schSel = schSel.filter(d => d !== date);
    else schSel.push(date);
    loadSchedule();
};

// ★追加: コマ単位の選択トグル処理
window.toggleSchKoma = (date, koma) => {
    const idx = schSelKomas.findIndex(item => item.date === date && item.koma === koma);
    if (idx > -1) {
        schSelKomas.splice(idx, 1); // 選択解除
    } else {
        schSelKomas.push({ date, koma }); // 選択追加
    }
    loadSchedule(); // 再描画
};

window.openSchModal = (date, koma, cid) => {
    editSchData = { date, koma };
    document.getElementById('schModalInfo').textContent = `${date} ${koma}限`;
    document.getElementById('schModalCourse').value = cid || 0;
    document.getElementById('schEditModal').style.display = 'block';
};

async function saveSingleSch() {
    const cid = document.getElementById('schModalCourse').value;
    if (editSchData) {
        const cls = document.getElementById('scheduleClassSelect').value;
        await updateSchedule(cls, [{ date: editSchData.date, koma: editSchData.koma, course_id: cid }]);
        document.getElementById('schEditModal').style.display = 'none';
        loadSchedule();
    }
}

async function applyMultiSch() {
    // どちらの選択リストも空ならアラート
    if (schSel.length === 0 && schSelKomas.length === 0) return alert("日付またはコマを選択してください");
    
    const cid = document.getElementById('schMultiCourseSelect').value;
    if (!cid) return;
    const cls = document.getElementById('scheduleClassSelect').value;
    
    let updates = [];
    let message = "";

    // A. コマ単位の選択がある場合（優先）
    if (schSelKomas.length > 0) {
        message = `${schSelKomas.length}個の選択したコマをこの授業に変更しますか？`;
        schSelKomas.forEach(item => {
            updates.push({ date: item.date, koma: item.koma, course_id: cid });
        });
    } 
    // B. 日付単位の選択しかない場合（既存の簡易動作）
    else {
        message = `${schSel.length}日分の全コマ(1-4限)をこの授業にしますか？`;
        schSel.forEach(d => {
            for(let k=1; k<=4; k++) updates.push({ date: d, koma: k, course_id: cid });
        });
    }

    if(!confirm(message)) return;

    await updateSchedule(cls, updates);
    
    // 選択状態をリセット
    schSel = [];
    schSelKomas = [];
    loadSchedule();
}

async function updateSchedule(cls, updates) {
    await fetch(`${API_BASE_URL}/update_schedule_date`, {
        method: 'POST', headers: {'Content-Type':'application/json'},
        body: JSON.stringify({ class_id: cls, updates })
    });
}

// ==========================================
// ▼ 生徒管理 (CRUD)
// ==========================================
async function loadStudentList() {
    const f = document.getElementById('studentCrudClassFilter');
    const tb = document.querySelector('#studentListTable tbody');
    if (!f || !tb) return;
    
    tb.innerHTML = '<tr><td colspan="6">読み込み中...</td></tr>';
    const res = await (await fetch(`${API_BASE_URL}/get_student_list?class_id=${f.value}`)).json();
    students = res.students || [];
    
    // クラス選択肢の更新
    const sel = document.getElementById('crudSClassSelect');
    sel.innerHTML = '<option value="new">＋新規クラス作成</option>';
    allClassIds.forEach(c => {
        sel.innerHTML += `<option value="${c}">${c}</option>`;
    });

    tb.innerHTML = '';
    students.forEach(s => {
        tb.innerHTML += `<tr>
            <td>${s.student_id}</td>
            <td>${s.student_name}</td>
            <td>${s.class_id}</td>
            <td>${s.attendance_rate ? s.attendance_rate+'%' : '-'}</td>
            <td>${s.email || ''}</td>
            <td><button class="btn-sm btn-permission" onclick='openStudentForm(${JSON.stringify(s)})'>編集</button></td>
        </tr>`;
    });
}

window.openStudentForm = (s) => {
    const f = document.getElementById('studentForm');
    f.style.display = 'block';
    
    if (s) {
        document.getElementById('crudSid').value = s.student_id;
        document.getElementById('crudSid').disabled = true;
        document.getElementById('crudSName').value = s.student_name;
        document.getElementById('crudSClassSelect').value = s.class_id;
        document.getElementById('crudSGen').value = s.gender || '設定しない';
        document.getElementById('crudSBirth').value = s.birthday ? s.birthday.split('T')[0] : '';
        document.getElementById('crudSEmail').value = s.email || '';
        document.getElementById('crudSPass').value = '';
        document.querySelector('.delete-btn').style.display = 'inline-block';
    } else {
        document.getElementById('crudSid').value = '';
        document.getElementById('crudSid').disabled = false;
        document.getElementById('crudSName').value = '';
        document.getElementById('crudSClassSelect').value = allClassIds.length > 0 ? allClassIds[0] : 'new';
        document.getElementById('crudSGen').value = '設定しない';
        document.getElementById('crudSBirth').value = '';
        document.getElementById('crudSEmail').value = '';
        document.getElementById('crudSPass').value = '';
        document.querySelector('.delete-btn').style.display = 'none';
    }
};

async function saveStudent() {
    const sid = document.getElementById('crudSid').value;
    const name = document.getElementById('crudSName').value;
    let cls = document.getElementById('crudSClassSelect').value;
    if (cls === 'new') cls = document.getElementById('crudSClassInput').value;
    const gen = document.getElementById('crudSGen').value;
    const birth = document.getElementById('crudSBirth').value;
    const mail = document.getElementById('crudSEmail').value;
    const pass = document.getElementById('crudSPass').value;

    if (!sid || !name || !cls) return alert("必須項目を入力してください");

    const mode = document.getElementById('crudSid').disabled ? 'update' : 'add';
    const body = { student_id: sid, student_name: name, class_id: cls, gender: gen, birthday: birth, email: mail, password: pass };
    
    await fetch(`${API_BASE_URL}/${mode}_student`, {
        method: 'POST', headers: {'Content-Type':'application/json'},
        body: JSON.stringify(body)
    });
    
    document.getElementById('studentForm').style.display = 'none';
    loadStudentList();
}

async function deleteStudent() {
    const sid = document.getElementById('crudSid').value;
    if (confirm("削除しますか？")) {
        await fetch(`${API_BASE_URL}/delete_student`, {
            method: 'POST', headers: {'Content-Type':'application/json'},
            body: JSON.stringify({ student_id: sid })
        });
        document.getElementById('studentForm').style.display = 'none';
        loadStudentList();
    }
}

// ==========================================
// ▼ 教員管理
// ==========================================
async function loadTeacherList() {
    const tb = document.querySelector('#teacherListTable tbody');
    tb.innerHTML = '<tr><td colspan="5">読み込み中...</td></tr>';
    const res = await (await fetch(`${API_BASE_URL}/get_teacher_list`)).json();
    teachers = res.teachers || [];
    
    tb.innerHTML = '';
    teachers.forEach(t => {
        tb.innerHTML += `<tr>
            <td>${t.teacher_id}</td>
            <td>${t.teacher_name}</td>
            <td>${(t.assigned_classes || []).join(', ')}</td>
            <td>${t.email || ''}</td>
            <td><button class="btn-sm btn-permission" onclick='openTeacherForm(${JSON.stringify(t)})'>編集</button></td>
        </tr>`;
    });
}

window.openTeacherForm = (t) => {
    document.getElementById('teacherForm').style.display = 'block';
    const box = document.getElementById('crudTClassCheckboxes');
    box.innerHTML = '';
    allClassIds.forEach(c => {
        const chk = t && t.assigned_classes && t.assigned_classes.includes(parseInt(c));
        box.innerHTML += `<label style="display:inline-block; margin-right:10px;"><input type="checkbox" value="${c}" ${chk?'checked':''}> Class ${c}</label>`;
    });

    if (t) {
        document.getElementById('crudTid').value = t.teacher_id;
        document.getElementById('crudTid').disabled = true;
        document.getElementById('crudTName').value = t.teacher_name;
        document.getElementById('crudTEmail').value = t.email || '';
        document.getElementById('crudTPass').value = '';
        document.querySelector('#teacherForm .delete-btn').style.display = 'inline-block';
    } else {
        document.getElementById('crudTid').value = '';
        document.getElementById('crudTid').disabled = false;
        document.getElementById('crudTName').value = '';
        document.getElementById('crudTEmail').value = '';
        document.getElementById('crudTPass').value = '';
        document.querySelector('#teacherForm .delete-btn').style.display = 'none';
    }
};

async function saveTeacher() {
    const tid = document.getElementById('crudTid').value;
    const name = document.getElementById('crudTName').value;
    const mail = document.getElementById('crudTEmail').value;
    const pass = document.getElementById('crudTPass').value;
    
    const assigned = [];
    document.querySelectorAll('#crudTClassCheckboxes input:checked').forEach(c => assigned.push(c.value));

    if (!tid || !name) return alert("IDと名前は必須です");

    const mode = document.getElementById('crudTid').disabled ? 'update' : 'add';
    await fetch(`${API_BASE_URL}/${mode}_teacher`, {
        method: 'POST', headers: {'Content-Type':'application/json'},
        body: JSON.stringify({ teacher_id: tid, teacher_name: name, email: mail, password: pass, assigned_classes: assigned })
    });
    
    document.getElementById('teacherForm').style.display = 'none';
    loadTeacherList();
}

async function deleteTeacher() {
    const tid = document.getElementById('crudTid').value;
    if (confirm("削除しますか？")) {
        await fetch(`${API_BASE_URL}/delete_teacher`, {
            method: 'POST', headers: {'Content-Type':'application/json'},
            body: JSON.stringify({ teacher_id: tid })
        });
        document.getElementById('teacherForm').style.display = 'none';
        loadTeacherList();
    }
}

// ==========================================
// ▼ 欠席届
// ==========================================
async function loadAbsence() {
    const d = document.getElementById('absenceDateFilter').value;
    const c = document.getElementById('absenceClassFilter').value;
    const tb = document.querySelector('#absenceTable tbody');
    tb.innerHTML = '';
    
    const res = await (await fetch(`${API_BASE_URL}/get_absence_reports?date=${d}&class_id=${c}`)).json();
    if (res.reports) {
        res.reports.forEach(r => {
            tb.innerHTML += `<tr>
                <td>${r.attendance_date}</td>
                <td>${r.student_name}</td>
                <td>${r.koma}限</td>
                <td>${r.reason}</td>
                <td>${r.status_name}</td>
            </tr>`;
        });
    } else {
        tb.innerHTML = '<tr><td colspan="5">なし</td></tr>';
    }
}

// ==========================================
// ▼ チャット
// ==========================================
async function loadChatStudents() {
    const c = document.getElementById('chatClassFilter').value;
    const s = document.getElementById('chatStudentSelect');
    s.innerHTML = '<option value="">生徒を選択</option>';
    const res = await (await fetch(`${API_BASE_URL}/get_student_list?class_id=${c}`)).json();
    if (res.students) {
        res.students.forEach(i => {
            s.innerHTML += `<option value="${i.student_id}">${i.student_name}</option>`;
        });
    }
}

async function loadChatHist() {
    const sid = document.getElementById('chatStudentSelect').value;
    const tid = sessionStorage.getItem('user_id');
    if (!sid) return;

    const res = await (await fetch(`${API_BASE_URL}/chat/history?user1=${tid}&user2=${sid}`)).json();
    const w = document.getElementById('teacherChatWindow');
    w.innerHTML = '';
    res.messages.forEach(m => {
        w.innerHTML += `<div class="chat-msg ${m.sender_id===tid?'mine':'theirs'}"><div>${m.message_content}</div><small>${m.time}</small></div>`;
    });
    w.scrollTop = w.scrollHeight;
}

async function sendChat() {
    const sid = document.getElementById('chatStudentSelect').value;
    const txt = document.getElementById('teacherChatInput').value;
    const tid = sessionStorage.getItem('user_id');
    if (!sid || !txt) return;

    await fetch(`${API_BASE_URL}/chat/send`, {
        method: 'POST', headers: {'Content-Type':'application/json'},
        body: JSON.stringify({ sender_id: tid, receiver_id: sid, content: txt })
    });
    document.getElementById('teacherChatInput').value = '';
    loadChatHist();
}

window.openBroadcast = () => {
    document.getElementById('broadcastModal').style.display = 'block';
    const box = document.getElementById('broadcastClassCheckboxes');
    box.innerHTML = '';
    allClassIds.forEach(c => {
        box.innerHTML += `<label style="display:block;"><input type="checkbox" value="${c}"> Class ${c}</label>`;
    });
};

async function sendBroadcast() {
    const txt = document.getElementById('broadcastInput').value;
    if (!txt) return;
    const ids = [];
    document.querySelectorAll('#broadcastClassCheckboxes input:checked').forEach(c => ids.push(c.value));
    if (ids.length === 0) return alert("クラスを選択してください");

    const tid = sessionStorage.getItem('user_id');
    await fetch(`${API_BASE_URL}/chat/broadcast`, {
        method: 'POST', headers: {'Content-Type':'application/json'},
        body: JSON.stringify({ sender_id: tid, class_ids: ids, content: txt })
    });
    alert("送信しました");
    document.getElementById('broadcastModal').style.display = 'none';
}

// ==========================================
// ★ 追加: CSV一括登録機能
// ==========================================
window.openCsvModal = () => {
    document.getElementById('csvUploadModal').style.display = 'block';
    const input = document.getElementById('csvFileInput');
    if(input) input.value = '';
};

window.uploadCsv = async () => {
    const input = document.getElementById('csvFileInput');
    if (!input.files || input.files.length === 0) {
        alert("ファイルを選択してください");
        return;
    }
    
    const formData = new FormData();
    formData.append('file', input.files[0]);
    
    const btn = event.target; // クリックされたボタン
    const originalText = btn.textContent;
    btn.disabled = true;
    btn.textContent = "送信中...";
    
    try {
        const res = await fetch(`${API_BASE_URL}/admin/register_bulk_students`, {
            method: 'POST',
            body: formData
        });
        const d = await res.json();
        
        if (d.success) {
            alert(d.message);
            document.getElementById('csvUploadModal').style.display = 'none';
            loadStudentList(); // リスト更新
        } else {
            alert("エラー: " + d.message);
        }
    } catch (e) {
        console.error(e);
        alert("通信エラーが発生しました");
    } finally {
        btn.disabled = false;
        btn.textContent = originalText;
    }
};