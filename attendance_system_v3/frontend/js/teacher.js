const API_BASE_URL = '/api';
let courses = [], komas = [], students = [], teachers = [], schSel = [], chatTimer = null;
let editStData = null, editSchData = null, allClassIds = [];

const checkAuth = () => {
    if (!sessionStorage.getItem('user_id') || sessionStorage.getItem('user_role') !== 'teacher') {
        location.replace('../html/index.html'); return false;
    } return true;
};
window.addEventListener('pageshow', () => checkAuth());

document.addEventListener('DOMContentLoaded', async () => {
    if (!checkAuth()) return;
    document.getElementById('teacherId').textContent = sessionStorage.getItem('user_id');
    const u = sessionStorage.getItem('unread_count');
    if (u && parseInt(u) > 0) { alert(`🔔 新着メッセージ: ${u}件`); sessionStorage.removeItem('unread_count'); }

    await initData();
    setupEvents();
    
    const d = new Date(), today = d.toISOString().split('T')[0], ym = `${d.getFullYear()}-${('0'+(d.getMonth()+1)).slice(-2)}`;
    document.getElementById('realtimeDate').value = today;
    document.getElementById('scheduleMonthInput').value = ym;
    document.getElementById('csvMonthInput').value = ym;
    document.getElementById('calBaseDate').value = today;
    document.getElementById('absenceDateFilter').value = today;
    
    loadRealtime();
});

async function initData() {
    try {
        const [r1, r2] = await Promise.all([fetch(`${API_BASE_URL}/get_course_koma`), fetch(`${API_BASE_URL}/get_class_list`)]);
        const d1 = await r1.json(), d2 = await r2.json();
        courses = d1.courses; komas = d1.komas; allClassIds = d2.classes.map(c => c.class_id);

        const setOp = (id, list, k, v, emp=false) => {
            const el = document.getElementById(id); if(!el)return;
            el.innerHTML = emp ? '<option value="0">(なし)</option>' : '';
            list.forEach(i => { const o = document.createElement('option'); o.value=i[k]; o.textContent=i[v]; el.appendChild(o); });
        };
        setOp('realtimeKoma', komas, 'koma_id', 'koma_name');
        setOp('schModalCourse', courses, 'course_id', 'course_name', true);
        setOp('schMultiCourseSelect', courses, 'course_id', 'course_name', true);
        setOp('stModalCourse', courses, 'course_id', 'course_name');
        setOp('stModalKoma', komas, 'koma_id', 'koma_name');

        const setCls = (id) => {
            const el = document.getElementById(id); if(!el)return;
            d2.classes.forEach(c => { const o=document.createElement('option'); o.value=c.class_id; o.textContent=`クラス${c.class_id}`; el.appendChild(o); });
        };
        ['realtimeClassFilter', 'scheduleClassSelect', 'calClassFilter', 'absenceClassFilter', 'chatClassFilter', 'studentCrudClassFilter'].forEach(setCls);

        const schEl = document.getElementById('scheduleClassSelect');
        if(schEl && schEl.options.length>0) schEl.value = schEl.options[0].value;
        
        const h = new Date().getHours(), m = new Date().getMinutes(), mm = h*60+m;
        let k = 1; if(mm>=645 && mm<750) k=2; else if(mm>=805 && mm<900) k=3; else if(mm>=910) k=4;
        const kEl = document.getElementById('realtimeKoma'); if(kEl) kEl.value = k;

    } catch(e) { console.error(e); }
}

function setupEvents() {
    document.getElementById('logoutButton').onclick = () => { sessionStorage.clear(); location.replace('../html/index.html'); };
    document.querySelectorAll('.tab-button').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.tab-button').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            document.querySelectorAll('.tab-content').forEach(c => c.style.display='none');
            document.getElementById(btn.dataset.tab).style.display='block';
            if(chatTimer) clearInterval(chatTimer);
            const t = btn.dataset.tab;
            if(t==='chat-mgr'){ loadChatStudents(); chatTimer=setInterval(loadChatHist,3000); }
            if(t==='schedule-mgr') loadSchedule();
            if(t==='student-attendance') loadCalStudents();
            if(t==='student-crud') loadStudentList();
            if(t==='teacher-crud') loadTeacherList();
        });
    });

    const bind = (id, func) => { const el=document.getElementById(id); if(el) el.onclick=func; };
    bind('refreshRealtime', loadRealtime);
    bind('schMultiApplyBtn', applyMultiSch);
    bind('schModalSave', saveSingleSch);
    bind('addCourseMasterBtn', async () => {
        const n=document.getElementById('newCourseName').value;
        if(n) { await fetch(`${API_BASE_URL}/add_course_master`, {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({course_name:n})}); location.reload(); }
    });
    bind('showCalendarBtn', loadCalendar);
    bind('stModalSave', saveStatus);
    bind('stModalDelete', deleteStatus);
    bind('teacherSendChatButton', sendChat);
    bind('broadcastChatButton', openBroadcast);
    bind('submitBroadcast', sendBroadcast);
    bind('refreshAbsenceReports', loadAbsence);

    const sCls = document.getElementById('scheduleClassSelect');
    if(sCls) sCls.onchange = loadSchedule;
    document.getElementById('scheduleMonthInput').onchange = loadSchedule;
    document.querySelectorAll('input[name="schMode"]').forEach(e => e.onchange = () => {
        document.getElementById('multiControls').style.display = e.value==='multi'?'inline':'none'; schSel=[]; loadSchedule();
    });
    
    document.getElementById('calClassFilter').onchange = loadCalStudents;
    document.getElementById('studentCrudClassFilter').onchange = loadStudentList;
    document.getElementById('chatClassFilter').onchange = loadChatStudents;
    document.getElementById('chatStudentSelect').onchange = loadChatHist;
    
    const crudSel = document.getElementById('crudSClassSelect');
    if(crudSel) crudSel.onchange = () => {
        const inp = document.getElementById('crudSClassInput');
        inp.style.display = crudSel.value==='new' ? 'inline-block' : 'none';
    };
}

// リアルタイム
async function loadRealtime() {
    const k=document.getElementById('realtimeKoma').value, d=document.getElementById('realtimeDate').value, c=document.getElementById('realtimeClassFilter').value;
    const res = await (await fetch(`${API_BASE_URL}/realtime_status?koma=${k}&date=${d}&class_id=${c}`)).json();
    const tb = document.querySelector('#realtimeTable tbody'); tb.innerHTML='';
    res.records.forEach(r => {
        const cls = r.attendance_status==='出席'?'status-present':(r.attendance_status==='欠席'?'status-absent':'');
        tb.innerHTML += `<tr><td>${r.student_id}</td><td>${r.student_name}</td><td>${r.class_id||'-'}</td><td>${r.course_name}</td><td class="${cls}">${r.attendance_status}</td><td>${r.time}</td><td><button onclick="jumpToDetail(${r.student_id},'${r.class_id}')" style="background:#17a2b8;">詳細</button></td></tr>`;
    });
}
window.jumpToDetail = async (sid, cid) => {
    document.querySelector('[data-tab="student-attendance"]').click();
    const sel = document.getElementById('calClassFilter');
    let exists = false; for(let i=0;i<sel.options.length;i++) if(sel.options[i].value==cid) exists=true;
    sel.value = exists ? cid : 'all';
    document.getElementById('calBaseDate').value = document.getElementById('realtimeDate').value;
    await loadCalStudents();
    document.getElementById('calStudentSelect').value = sid;
    loadCalendar();
};

// カレンダー
async function loadCalStudents() {
    const res = await (await fetch(`${API_BASE_URL}/get_student_list?class_id=${document.getElementById('calClassFilter').value}`)).json();
    const s = document.getElementById('calStudentSelect'); s.innerHTML='<option value="">選択</option>';
    res.students.forEach(i => s.innerHTML+=`<option value="${i.student_id}">${i.student_name}</option>`);
}
async function loadCalendar() {
    const sid = document.getElementById('calStudentSelect').value; if(!sid) return alert('生徒を選択');
    const bd = new Date(document.getElementById('calBaseDate').value);
    let s, e;
    if(document.getElementById('calViewType').value==='week') {
        s=new Date(bd); s.setDate(bd.getDate()-bd.getDay()); e=new Date(s); e.setDate(s.getDate()+6);
    } else { s=new Date(bd.getFullYear(), bd.getMonth(), 1); e=new Date(bd.getFullYear(), bd.getMonth()+1, 0); }
    const fmt=d=>`${d.getFullYear()}-${('0'+(d.getMonth()+1)).slice(-2)}-${('0'+d.getDate()).slice(-2)}`;
    const res = await (await fetch(`${API_BASE_URL}/get_student_attendance_range?student_id=${sid}&start_date=${fmt(s)}&end_date=${fmt(e)}`)).json();
    let h='<div class="month-calendar">'; ['日','月','火','水','木','金','土'].forEach(x=>h+=`<div class="month-day-header">${x}</div>`);
    if(document.getElementById('calViewType').value==='month') for(let i=0;i<s.getDay();i++) h+='<div></div>';
    for(let d=new Date(s); d<=e; d.setDate(d.getDate()+1)) {
        const dt=fmt(d); const recs=res.records.filter(r=>r.attendance_date===dt); recs.sort((a,b)=>a.koma-b.koma);
        let b=''; recs.forEach(r=>{ let c=r.status_id==1?'bg-present':r.status_id==3?'bg-absent':'bg-late'; b+=`<div class="mini-badge ${c}" onclick="openStModal(${sid},'',${r.course_id},${r.koma},'${dt}')">${r.koma}:${r.status_text}</div>`});
        h+=`<div class="month-day"><div style="display:flex;justify-content:space-between;"><span class="day-number">${d.getDate()}</span><span style="cursor:pointer;color:blue;" onclick="openStModal(${sid},'',0,0,'${dt}')">＋</span></div>${b}</div>`;
    }
    document.getElementById('calendarContainer').innerHTML = h+'</div>';
}
window.openStModal = (sid, n, cid, k, d) => {
    editStData = {sid, date:d}; document.getElementById('stModalInfo').textContent = `${d}`;
    const ck=document.getElementById('stModalKoma'); ck.value=k||1; ck.disabled=!!k;
    document.getElementById('stModalCourse').value = cid||(courses[0]?courses[0].course_id:0);
    document.getElementById('statusChangeModal').style.display='block';
};
async function saveStatus() {
    const k=document.getElementById('stModalKoma').value, c=document.getElementById('stModalCourse').value;
    await fetch(`${API_BASE_URL}/update_attendance_status`, {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({student_id:editStData.sid, course_id:c, koma:k, date:editStData.date, status_id:document.getElementById('stModalSelect').value})});
    document.getElementById('statusChangeModal').style.display='none';
    if(document.getElementById('student-attendance').style.display!=='none') loadCalendar(); else loadRealtime();
}
async function deleteStatus() {
    if(!confirm('削除しますか？')) return;
    await fetch(`${API_BASE_URL}/delete_attendance_record`, {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({student_id:editStData.sid, date:editStData.date, koma:document.getElementById('stModalKoma').value})});
    document.getElementById('statusChangeModal').style.display='none';
    if(document.getElementById('student-attendance').style.display!=='none') loadCalendar(); else loadRealtime();
}

// 生徒管理
async function loadStudentList() {
    const c=document.getElementById('studentCrudClassFilter').value;
    const res = await (await fetch(`${API_BASE_URL}/get_student_list?class_id=${c==='all'?'':c}`)).json();
    students = res.students;
    const tb = document.querySelector('#studentListTable tbody'); tb.innerHTML='';
    students.forEach(s => {
        // ★修正: アクションボタン列を追加
        tb.innerHTML += `
            <tr>
                <td>${s.student_id}</td>
                <td>${s.student_name}</td>
                <td>${s.class_id}</td>
                <td>${s.email||''}</td>
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
    document.getElementById('studentForm').style.display='block';
    const sel=document.getElementById('crudSClassSelect'); sel.innerHTML='';
    allClassIds.forEach(c=>sel.innerHTML+=`<option value="${c}">クラス${c}</option>`); sel.innerHTML+='<option value="new">＋ 新規クラス</option>';
    document.getElementById('crudSClassInput').style.display='none';
    if(id) {
        const s=students.find(x=>x.student_id==id);
        document.getElementById('crudSid').value=s.student_id; document.getElementById('crudSid').disabled=true;
        document.getElementById('crudSName').value=s.student_name; sel.value=s.class_id||allClassIds[0];
        document.getElementById('crudSGen').value=s.gender||'設定しない'; document.getElementById('crudSBirth').value=s.birthday;
        document.getElementById('crudSEmail').value=s.email;
    } else {
        document.getElementById('crudSid').disabled=false; document.getElementById('crudSid').value='';
        document.getElementById('crudSPass').value='password';
    }
};
window.saveStudent = async () => {
    const sid=document.getElementById('crudSid').value, name=document.getElementById('crudSName').value, pass=document.getElementById('crudSPass').value;
    let cls=document.getElementById('crudSClassSelect').value; if(cls==='new') cls=document.getElementById('crudSClassInput').value;
    if(!sid||!name||!cls||!pass) return alert('入力不足');
    const body = {student_id:sid, student_name:name, class_id:cls, gender:document.getElementById('crudSGen').value, birthday:document.getElementById('crudSBirth').value, email:document.getElementById('crudSEmail').value, password:pass};
    const url = document.getElementById('crudSid').disabled ? 'update_student' : 'add_student';
    const res = await (await fetch(`${API_BASE_URL}/${url}`, {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body)})).json();
    if(res.success) { alert('保存しました'); location.reload(); } else alert('エラー');
};
window.deleteStudent = async () => {
    if(confirm('削除しますか？')) { await fetch(`${API_BASE_URL}/delete_student`, {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({student_id:document.getElementById('crudSid').value})}); loadStudentList(); document.getElementById('studentForm').style.display='none'; }
};

// ★追加: 顔登録許可 (5分間)
window.allowFaceReg = async (sid) => {
    if(!confirm(`ID: ${sid} の顔登録を許可しますか？\n(許可してから5分間だけ登録可能になります)`)) return;
    try {
        const res = await (await fetch(`${API_BASE_URL}/allow_face_registration`, {
            method: 'POST',
            headers: {'Content-Type':'application/json'},
            body: JSON.stringify({student_id: sid})
        })).json();
        if(res.success) alert(`許可しました。\n期限: ${res.expiry} まで`);
        else alert('エラー: ' + res.message);
    } catch(e) { console.error(e); alert('通信エラー'); }
};

// ★追加: パスワードリセット
window.resetPassword = async (sid) => {
    const newPass = prompt(`ID: ${sid} の新しいパスワードを入力してください:`);
    if(!newPass) return; 
    try {
        const res = await (await fetch(`${API_BASE_URL}/reset_student_password`, {
            method: 'POST',
            headers: {'Content-Type':'application/json'},
            body: JSON.stringify({student_id: sid, new_password: newPass})
        })).json();
        if(res.success) alert('パスワードを変更しました');
        else alert('エラー: ' + res.message);
    } catch(e) { console.error(e); alert('通信エラー'); }
};

// 教員・チャット・欠席届・その他は以前と同様
window.saveTeacher=async()=>{
    const tid=document.getElementById('crudTid').value, tname=document.getElementById('crudTName').value, em=document.getElementById('crudTEmail').value, pw=document.getElementById('crudTPass').value;
    if(!tid||!tname||!em||!pw) return alert('入力不足');
    const cls=[]; document.querySelectorAll('#crudTClassCheckboxes input:checked').forEach(c=>cls.push(parseInt(c.value)));
    const url=document.getElementById('crudTid').disabled?'update_teacher':'add_teacher';
    await fetch(`${API_BASE_URL}/${url}`, {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({teacher_id:tid, teacher_name:tname, email:em, password:pw, assigned_classes:cls})});
    alert('保存しました'); document.getElementById('teacherForm').style.display='none'; loadTeacherList();
};
window.deleteTeacher=async()=>{ if(confirm('削除しますか？')) await fetch(`${API_BASE_URL}/delete_teacher`, {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({teacher_id:document.getElementById('crudTid').value})}); loadTeacherList(); document.getElementById('teacherForm').style.display='none'; };
async function loadTeacherList(){
    const res=await(await fetch(`${API_BASE_URL}/get_teacher_list`)).json(); teachers=res.teachers;
    const tb=document.querySelector('#teacherListTable tbody'); tb.innerHTML='';
    teachers.forEach(t=>tb.innerHTML+=`<tr><td>${t.teacher_id}</td><td>${t.teacher_name}</td><td>${t.assigned_classes.join(',')}</td><td>${t.email}</td><td><button onclick="openTeacherForm('${t.teacher_id}')">編集</button></td></tr>`);
}
window.openTeacherForm=(id)=>{
    document.getElementById('teacherForm').style.display='block'; const box=document.getElementById('crudTClassCheckboxes'); box.innerHTML='';
    allClassIds.forEach(c=>box.innerHTML+=`<label style="display:block;"><input type="checkbox" value="${c}"> クラス${c}</label>`);
    if(id){
        const t=teachers.find(x=>x.teacher_id==id);
        document.getElementById('crudTid').value=t.teacher_id; document.getElementById('crudTid').disabled=true;
        document.getElementById('crudTName').value=t.teacher_name; document.getElementById('crudTEmail').value=t.email; document.getElementById('crudTPass').value=t.password;
        t.assigned_classes.forEach(c=>{ const el=box.querySelector(`input[value="${c}"]`); if(el)el.checked=true; });
    } else { document.getElementById('crudTid').disabled=false; document.getElementById('crudTid').value=''; }
};

async function loadChatStudents() {
    const res = await (await fetch(`${API_BASE_URL}/get_student_list?class_id=${document.getElementById('chatClassFilter').value}`)).json();
    const s = document.getElementById('chatStudentSelect'); s.innerHTML='<option value="">選択</option>';
    res.students.forEach(i => s.innerHTML+=`<option value="${i.student_id}">${i.student_name}</option>`);
}
async function loadChatHist() {
    const sid=document.getElementById('chatStudentSelect').value; if(!sid) return;
    const res = await (await fetch(`${API_BASE_URL}/chat/history?user1=${sessionStorage.getItem('user_id')}&user2=${sid}`)).json();
    const w=document.getElementById('teacherChatWindow'); w.innerHTML='';
    res.messages.forEach(m=>w.innerHTML+=`<div class="message-bubble ${m.sender_id==sessionStorage.getItem('user_id')?'mine':'theirs'}"><div>${m.message_content}</div><div class="message-time">${m.time}</div></div>`);
    w.scrollTop=w.scrollHeight;
}
async function sendChat() {
    const txt=document.getElementById('teacherChatInput').value, sid=document.getElementById('chatStudentSelect').value;
    if(!txt||!sid) return;
    await fetch(`${API_BASE_URL}/chat/send`, {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({sender_id:sessionStorage.getItem('user_id'), receiver_id:sid, content:txt})});
    document.getElementById('teacherChatInput').value=''; loadChatHist();
}
window.openBroadcast = () => {
    document.getElementById('broadcastModal').style.display='block'; const box=document.getElementById('broadcastClassCheckboxes'); box.innerHTML='';
    allClassIds.forEach(c=>box.innerHTML+=`<label style="display:block;"><input type="checkbox" value="${c}"> クラス${c}</label>`);
};
async function sendBroadcast() {
    const ids=[], txt=document.getElementById('broadcastInput').value; document.querySelectorAll('#broadcastClassCheckboxes input:checked').forEach(c=>ids.push(parseInt(c.value)));
    if(!ids.length||!txt) return alert('入力不足');
    const res = await (await fetch(`${API_BASE_URL}/chat/broadcast`, {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({sender_id:sessionStorage.getItem('user_id'), class_ids:ids, content:txt})})).json();
    alert(`${res.count}件送信完了`); document.getElementById('broadcastModal').style.display='none'; loadChatHist();
}
async function loadAbsence() {
    const res = await (await fetch(`${API_BASE_URL}/get_absence_reports?date=${document.getElementById('absenceDateFilter').value}&class_id=${document.getElementById('absenceClassFilter').value}`)).json();
    const tb=document.querySelector('#absenceTable tbody'); tb.innerHTML='';
    const g={}; res.reports.forEach(r=>{ const k=`${r.attendance_date}_${r.student_id}`; if(!g[k])g[k]={d:r.attendance_date,n:r.student_name,r:r.reason,l:[]}; g[k].l.push(r); });
    Object.keys(g).forEach((k,i)=>{
        const item=g[k], ks=item.l.map(x=>x.koma).join(',')+'限';
        tb.innerHTML+=`<tr style="background:white;"><td>${item.d}</td><td>${item.n}</td><td>${ks}</td><td>${item.r}</td><td><button onclick="toggleRow('ab-det-${i}')">詳細</button></td></tr><tr id="ab-det-${i}" style="display:none;background:#f9f9f9;"><td colspan="5"><table style="width:100%;"><tbody>${item.l.map(x=>`<tr><td>${x.koma}限</td><td>${x.course_name}</td><td>${x.status_name}</td></tr>`).join('')}</tbody></table></td></tr>`;
    });
}
window.toggleRow = id => { const el=document.getElementById(id); el.style.display=el.style.display==='none'?'table-row':'none'; };
window.downloadCsv = () => {
    const c=document.getElementById('calClassFilter').value, ym=document.getElementById('csvMonthInput').value;
    if(!c||c==='all'||!ym) return alert('クラスと年月を指定してください');
    window.location.href=`${API_BASE_URL}/download_attendance_csv?class_id=${c}&year=${ym.split('-')[0]}&month=${ym.split('-')[1]}`;
};