const API_BASE_URL = '/api';
let courses = [], komas = [], students = [], teachers = [], schSel = [], chatTimer = null;
let editStData = null, editSchData = null, allClassIds = [];

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
            schSel = [];
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
    if (!sidEl || !sidEl.value) return alert('生徒を選択してください');

    const bdEl = document.getElementById('calBaseDate');
    if (!bdEl) return;
    const bd = new Date(bdEl.value);

    let s, e;
    const vEl = document.getElementById('calViewType');
    if (vEl && vEl.value === 'week') {
        s = new Date(bd); s.setDate(bd.getDate() - bd.getDay()); e = new Date(s); e.setDate(s.getDate() + 6);
    } else {
        s = new Date(bd.getFullYear(), bd.getMonth(), 1); e = new Date(bd.getFullYear(), bd.getMonth() + 1, 0);
    }

    const fmt = d => `${d.getFullYear()}-${('0' + (d.getMonth() + 1)).slice(-2)}-${('0' + d.getDate()).slice(-2)}`;

    try {
        const res = await (await fetch(`${API_BASE_URL}/get_student_attendance_range?student_id=${sidEl.value}&start_date=${fmt(s)}&end_date=${fmt(e)}`)).json();

        let h = '<div class="month-calendar">';
        ['日', '月', '火', '水', '木', '金', '土'].forEach(x => h += `<div class="month-day-header">${x}</div>`);

        if (vEl && vEl.value === 'month') {
            for (let i = 0; i < s.getDay(); i++) h += '<div></div>';
        }

        for (let d = new Date(s); d <= e; d.setDate(d.getDate() + 1)) {
            const dt = fmt(d);
            const recs = res.records.filter(r => r.attendance_date === dt);
            recs.sort((a, b) => a.koma - b.koma);

            let b = '';
            recs.forEach(r => {
                let c = r.status_id == 1 ? 'bg-present' : r.status_id == 3 ? 'bg-absent' : 'bg-late';
                b += `<div class="mini-badge ${c}" onclick="openStModal(${sidEl.value},'',${r.course_id},${r.koma},'${dt}')">${r.koma}:${r.status_text}</div>`
            });
            h += `<div class="month-day">
                    <div style="display:flex;justify-content:space-between;">
                        <span class="day-number">${d.getDate()}</span>
                        <span style="cursor:pointer;color:blue;" onclick="openStModal(${sidEl.value},'',0,0,'${dt}')">＋</span>
                    </div>
                    ${b}
                  </div>`;
        }

        const con = document.getElementById('calendarContainer');
        if (con) con.innerHTML = h + '</div>';

    } catch (e) {
        console.error(e);
        alert("カレンダー取得エラー");
    }
}

window.openStModal = (sid, n, cid, k, d) => {
    editStData = { sid, date: d };
    const info = document.getElementById('stModalInfo');
    if (info) info.textContent = `${d}`;

    const ck = document.getElementById('stModalKoma');
    if (ck) { ck.value = k || 1; ck.disabled = !!k; }

    const cc = document.getElementById('stModalCourse');
    if (cc) cc.value = cid || (courses[0] ? courses[0].course_id : 0);

    const delBtn = document.getElementById('stModalDelete');
    if (delBtn) {
        delBtn.style.display = (k && k !== 0) ? 'block' : 'none';
    }

    const m = document.getElementById('statusChangeModal');
    if (m) m.style.display = 'block';
};

async function saveStatus() {
    const k = document.getElementById('stModalKoma').value;
    const c = document.getElementById('stModalCourse').value;
    const st = document.getElementById('stModalSelect').value;

    await fetch(`${API_BASE_URL}/update_attendance_status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ student_id: editStData.sid, course_id: c, koma: k, date: editStData.date, status_id: st })
    });

    document.getElementById('statusChangeModal').style.display = 'none';
    const calTab = document.getElementById('student-attendance');
    if (calTab && calTab.style.display !== 'none') loadCalendar(); else loadRealtime();
}

async function deleteStatus() {
    if (!confirm('本当に削除しますか？\n（取り消しはできません）')) return;
    await fetch(`${API_BASE_URL}/delete_attendance_record`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ student_id: editStData.sid, date: editStData.date, koma: document.getElementById('stModalKoma').value })
    });
    document.getElementById('statusChangeModal').style.display = 'none';
    const calTab = document.getElementById('student-attendance');
    if (calTab && calTab.style.display !== 'none') loadCalendar(); else loadRealtime();
}

// ==========================================
// ▼ 時間割管理
// ==========================================
async function loadSchedule() {
    const ymEl = document.getElementById('scheduleMonthInput');
    const clsEl = document.getElementById('scheduleClassSelect');
    if (!ymEl || !clsEl) return;
    
    const ym = ymEl.value.split('-');
    const cls = clsEl.value;
    if (!cls) return;

    const r = await fetch(`${API_BASE_URL}/get_monthly_schedule?class_id=${cls}&year=${ym[0]}&month=${ym[1]}`);
    const d = await r.json();

    const s = new Date(ym[0], ym[1] - 1, 1);
    const e = new Date(ym[0], ym[1], 0);

    let h = '<div class="month-calendar">';
    ['日', '月', '火', '水', '木', '金', '土'].forEach(x => h += `<div class="month-day-header">${x}</div>`);

    const modeEl = document.querySelector('input[name="schMode"]:checked');
    const mode = modeEl ? modeEl.value : 'single';

    for (let i = 0; i < s.getDay(); i++) h += '<div></div>';

    for (let i = 1; i <= e.getDate(); i++) {
        const dt = `${ym[0]}-${ym[1].toString().padStart(2, '0')}-${i.toString().padStart(2, '0')}`;
        let slots = '';

        for (let k = 1; k <= 4; k++) {
            const item = d.schedule.find(x => x.schedule_date === dt && x.koma === k);
            const name = item ? item.course_name : '-';
            const bg = item ? '#e3f2fd' : '#f9f9f9';

            const isSelected = schSel.find(x => x.date === dt && x.koma === k);
            const border = isSelected ? '2px solid orange' : '1px solid #ddd';

            const act = mode === 'single' ? `openSchEdit(${cls},'${dt}',${k})` : `toggleSlot(this,'${dt}',${k})`;
            slots += `<div class="mini-badge" style="background:${bg}; border:${border}; cursor:pointer;" onclick="${act}">${k}:${name}</div>`;
        }
        h += `<div class="month-day"><span class="day-number">${i}</span>${slots}</div>`;
    }
    document.getElementById('scheduleCalendarWrapper').innerHTML = h + '</div>';
}

window.toggleSlot = (el, d, k) => {
    const idx = schSel.findIndex(x => x.date === d && x.koma === k);
    if (idx >= 0) schSel.splice(idx, 1); else schSel.push({ date: d, koma: k });
    loadSchedule();
};

window.openSchEdit = (cls, d, k) => {
    editSchData = { cls, d, k };
    const info = document.getElementById('schModalInfo');
    if (info) info.textContent = `${d} ${k}限`;
    document.getElementById('schEditModal').style.display = 'block';
};

async function saveSingleSch() {
    const cid = document.getElementById('schModalCourse').value;
    await fetch(`${API_BASE_URL}/update_schedule_date`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            class_id: editSchData.cls,
            updates: [{ date: editSchData.d, koma: editSchData.k, course_id: cid }]
        })
    });
    document.getElementById('schEditModal').style.display = 'none';
    loadSchedule();
}

async function applyMultiSch() {
    const cid = document.getElementById('schMultiCourseSelect').value;
    const ups = schSel.map(s => ({ date: s.date, koma: s.koma, course_id: cid }));
    await fetch(`${API_BASE_URL}/update_schedule_date`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ class_id: document.getElementById('scheduleClassSelect').value, updates: ups })
    });
    schSel = [];
    loadSchedule();
}

// ==========================================
// ▼ 生徒管理・顔許可・PWリセット
// ==========================================
async function loadStudentList() {
    const cf = document.getElementById('studentCrudClassFilter');
    if (!cf) return;
    const res = await (await fetch(`${API_BASE_URL}/get_student_list?class_id=${cf.value === 'all' ? '' : cf.value}`)).json();
    students = res.students || [];
    const tb = document.querySelector('#studentListTable tbody');
    if (!tb) return;
    tb.innerHTML = '';
    students.forEach(s => {
        tb.innerHTML += `
            <tr>
                <td>${s.student_id}</td>
                <td>${s.student_name}</td>
                <td>${s.class_id}</td>
                <td>${s.email || ''}</td>
                <td>
                    <div class="action-btn-group">
                        <button class="btn-sm" onclick="openStudentForm(${s.student_id})">編集</button>
                        <button class="btn-sm btn-permission" onclick="allowFaceReg(${s.student_id})">📷 許可</button>
                        <button class="btn-sm btn-reset" onclick="resetPassword(${s.student_id})">🔑 PW</button>
                    </div>
                </td>
            </tr>`;
    });
}

window.openStudentForm = (id) => {
    document.getElementById('studentForm').style.display = 'block';
    const sel = document.getElementById('crudSClassSelect');
    if (sel) {
        sel.innerHTML = '';
        allClassIds.forEach(c => sel.innerHTML += `<option value="${c}">クラス${c}</option>`);
        sel.innerHTML += '<option value="new">＋ 新規クラス</option>';
    }
    const inp = document.getElementById('crudSClassInput');
    if (inp) inp.style.display = 'none';

    if (id) {
        const s = students.find(x => x.student_id == id);
        document.getElementById('crudSid').value = s.student_id;
        document.getElementById('crudSid').disabled = true;
        document.getElementById('crudSName').value = s.student_name;
        if (sel) sel.value = s.class_id || (allClassIds[0] || '');
        document.getElementById('crudSGen').value = s.gender || '設定しない';
        document.getElementById('crudSBirth').value = s.birthday;
        document.getElementById('crudSEmail').value = s.email;
    } else {
        document.getElementById('crudSid').disabled = false;
        document.getElementById('crudSid').value = '';
        document.getElementById('crudSPass').value = 'password';
    }
};

window.saveStudent = async () => {
    const sid = document.getElementById('crudSid').value, name = document.getElementById('crudSName').value, pass = document.getElementById('crudSPass').value;
    let cls = document.getElementById('crudSClassSelect').value;
    if (cls === 'new') cls = document.getElementById('crudSClassInput').value;

    // ★入力チェック (生徒IDは数字6桁)
    if (!sid || !name || !cls || !pass) return alert('入力不足です。全ての項目を入力してください。');
    if (!sid.match(/^\d{6}$/)) return alert('生徒IDは数字6桁で入力してください。');

    const body = {
        student_id: sid, student_name: name, class_id: cls,
        gender: document.getElementById('crudSGen').value,
        birthday: document.getElementById('crudSBirth').value,
        email: document.getElementById('crudSEmail').value,
        password: pass
    };
    const url = document.getElementById('crudSid').disabled ? 'update_student' : 'add_student';
    try {
        const res = await (await fetch(`${API_BASE_URL}/${url}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })).json();
        if (res.success) { alert('保存しました'); location.reload(); } else alert('エラー: ' + res.message);
    } catch (e) { alert('エラー: ' + e); }
};

window.deleteStudent = async () => {
    if (confirm('削除しますか？')) {
        await fetch(`${API_BASE_URL}/delete_student`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ student_id: document.getElementById('crudSid').value }) });
        loadStudentList();
        document.getElementById('studentForm').style.display = 'none';
    }
};

window.allowFaceReg = async (sid) => {
    if (!confirm(`ID: ${sid} の顔登録を許可しますか？\n(許可してから5分間だけ登録可能になります)`)) return;
    try {
        const res = await (await fetch(`${API_BASE_URL}/allow_face_registration`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ student_id: sid })
        })).json();
        if (res.success) alert(`許可しました。\n期限: ${res.expiry} まで`);
        else alert('エラー: ' + res.message);
    } catch (e) { console.error(e); alert('通信エラー'); }
};

window.resetPassword = async (sid) => {
    const newPass = prompt(`ID: ${sid} の新しいパスワードを入力してください:`);
    if (!newPass) return;
    try {
        const res = await (await fetch(`${API_BASE_URL}/reset_student_password`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ student_id: sid, new_password: newPass })
        })).json();
        if (res.success) alert('パスワードを変更しました');
        else alert('エラー: ' + res.message);
    } catch (e) { console.error(e); alert('通信エラー'); }
};

// ==========================================
// ▼ 教員管理
// ==========================================
window.saveTeacher = async () => {
    const tid = document.getElementById('crudTid').value, tname = document.getElementById('crudTName').value, em = document.getElementById('crudTEmail').value, pw = document.getElementById('crudTPass').value;
    
    // ★入力チェック (教員IDはT+5桁)
    if (!tid || !tname || !em || !pw) return alert('入力不足です。全ての項目を入力してください。');
    if (!tid.toUpperCase().match(/^T\d{5}$/)) return alert('教員IDは「T」で始まる数字5桁(例: T12345)で入力してください。');

    const cls = []; document.querySelectorAll('#crudTClassCheckboxes input:checked').forEach(c => cls.push(parseInt(c.value)));
    const url = document.getElementById('crudTid').disabled ? 'update_teacher' : 'add_teacher';
    const requester = sessionStorage.getItem('user_id');
    const res = await (await fetch(`${API_BASE_URL}/${url}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ teacher_id: tid, teacher_name: tname, email: em, password: pw, assigned_classes: cls, requester_id: requester })
    })).json();
    if (res.success) { alert('保存しました'); document.getElementById('teacherForm').style.display = 'none'; loadTeacherList(); }
    else { alert('エラー: ' + res.message); }
};

window.deleteTeacher = async () => {
    if (confirm('削除しますか？')) {
        const requester = sessionStorage.getItem('user_id');
        const res = await (await fetch(`${API_BASE_URL}/delete_teacher`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ teacher_id: document.getElementById('crudTid').value, requester_id: requester })
        })).json();
        if (res.success) { loadTeacherList(); document.getElementById('teacherForm').style.display = 'none'; }
        else { alert('エラー: ' + res.message); }
    }
};

async function loadTeacherList() {
    const res = await (await fetch(`${API_BASE_URL}/get_teacher_list`)).json();
    teachers = res.teachers;
    const tb = document.querySelector('#teacherListTable tbody'); tb.innerHTML = '';
    teachers.forEach(t => tb.innerHTML += `<tr><td>${t.teacher_id}</td><td>${t.teacher_name}</td><td>${t.assigned_classes.join(',')}</td><td>${t.email}</td><td><button onclick="openTeacherForm('${t.teacher_id}')">編集</button></td></tr>`);
}
window.openTeacherForm = (id) => {
    document.getElementById('teacherForm').style.display = 'block';
    const box = document.getElementById('crudTClassCheckboxes'); box.innerHTML = '';
    allClassIds.forEach(c => box.innerHTML += `<label style="display:block;"><input type="checkbox" value="${c}"> クラス${c}</label>`);
    if (id) {
        const t = teachers.find(x => x.teacher_id == id);
        document.getElementById('crudTid').value = t.teacher_id; document.getElementById('crudTid').disabled = true;
        document.getElementById('crudTName').value = t.teacher_name; document.getElementById('crudTEmail').value = t.email; document.getElementById('crudTPass').value = t.password;
        t.assigned_classes.forEach(c => { const el = box.querySelector(`input[value="${c}"]`); if (el) el.checked = true; });
    } else { document.getElementById('crudTid').disabled = false; document.getElementById('crudTid').value = ''; }
};

// ==========================================
// ▼ チャット機能
// ==========================================
async function loadChatStudents() {
    const el = document.getElementById('chatClassFilter');
    if (!el) return;
    const res = await (await fetch(`${API_BASE_URL}/get_student_list?class_id=${el.value}`)).json();
    const s = document.getElementById('chatStudentSelect');
    if (!s) return;
    s.innerHTML = '<option value="">選択</option>';
    if (res.students) res.students.forEach(i => s.innerHTML += `<option value="${i.student_id}">${i.student_name}</option>`);
}

async function loadChatHist() {
    const sid = document.getElementById('chatStudentSelect').value; if (!sid) return;
    const res = await (await fetch(`${API_BASE_URL}/chat/history?user1=${sessionStorage.getItem('user_id')}&user2=${sid}`)).json();
    const w = document.getElementById('teacherChatWindow'); w.innerHTML = '';
    res.messages.forEach(m => w.innerHTML += `<div class="message-bubble ${m.sender_id == sessionStorage.getItem('user_id') ? 'mine' : 'theirs'}"><div>${m.message_content}</div><div class="message-time">${m.time}</div></div>`);
    w.scrollTop = w.scrollHeight;
}

// 連打防止付きチャット送信
async function sendChat() {
    const txt = document.getElementById('teacherChatInput').value;
    const sid = document.getElementById('chatStudentSelect').value;
    const btn = document.getElementById('teacherSendChatButton');
    
    if (!txt || !sid) return;
    
    btn.disabled = true;
    await fetch(`${API_BASE_URL}/chat/send`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sender_id: sessionStorage.getItem('user_id'), receiver_id: sid, content: txt }) });
    document.getElementById('teacherChatInput').value = '';
    loadChatHist();
    btn.disabled = false;
}

window.openBroadcast = () => {
    document.getElementById('broadcastModal').style.display = 'block';
    const box = document.getElementById('broadcastClassCheckboxes'); box.innerHTML = '';
    allClassIds.forEach(c => box.innerHTML += `<label style="display:block;"><input type="checkbox" value="${c}"> クラス${c}</label>`);
};

async function sendBroadcast() {
    const ids = [], txt = document.getElementById('broadcastInput').value;
    const btn = document.getElementById('submitBroadcast');
    document.querySelectorAll('#broadcastClassCheckboxes input:checked').forEach(c => ids.push(parseInt(c.value)));
    
    if (!ids.length || !txt) return alert('入力不足');
    
    btn.disabled = true;
    const res = await (await fetch(`${API_BASE_URL}/chat/broadcast`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sender_id: sessionStorage.getItem('user_id'), class_ids: ids, content: txt }) })).json();
    alert(`${res.count}件送信完了`);
    document.getElementById('broadcastModal').style.display = 'none';
    loadChatHist();
    btn.disabled = false;
}

async function loadAbsence() {
    const dEl = document.getElementById('absenceDateFilter');
    const cEl = document.getElementById('absenceClassFilter');
    if (!dEl || !cEl) return;

    const res = await (await fetch(`${API_BASE_URL}/get_absence_reports?date=${dEl.value}&class_id=${cEl.value}`)).json();
    const tb = document.querySelector('#absenceTable tbody');
    if (!tb) return;
    tb.innerHTML = '';

    const g = {};
    if (res.reports) res.reports.forEach(r => { const k = `${r.attendance_date}_${r.student_id}`; if (!g[k]) g[k] = { d: r.attendance_date, n: r.student_name, r: r.reason, l: [] }; g[k].l.push(r); });

    Object.keys(g).forEach((k, i) => {
        const item = g[k], ks = item.l.map(x => x.koma).join(',') + '限';
        tb.innerHTML += `<tr style="background:white;"><td>${item.d}</td><td>${item.n}</td><td>${ks}</td><td>${item.r}</td><td><button onclick="toggleRow('ab-det-${i}')">詳細</button></td></tr><tr id="ab-det-${i}" style="display:none;background:#f9f9f9;"><td colspan="5"><table style="width:100%;"><tbody>${item.l.map(x => `<tr><td>${x.koma}限</td><td>${x.course_name}</td><td>${x.status_name}</td></tr>`).join('')}</tbody></table></td></tr>`;
    });
}
window.toggleRow = id => { const el = document.getElementById(id); if (el) el.style.display = el.style.display === 'none' ? 'table-row' : 'none'; };

window.downloadCsv = () => {
    const c = document.getElementById('calClassFilter').value, ym = document.getElementById('csvMonthInput').value;
    if (!c || c === 'all' || !ym) return alert('クラスと年月を指定してください');
    
    const [year, month] = ym.split('-');
    window.location.href = `${API_BASE_URL}/download_attendance_csv?class_id=${c}&year=${year}&month=${month}`;
};