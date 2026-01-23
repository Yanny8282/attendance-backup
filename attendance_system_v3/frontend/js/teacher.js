// ★修正箇所: HTTPS化に伴い、相対パスに変更
const API_BASE_URL = '/api';
let courses=[], komas=[], students=[], teachers=[], schSel=[], chatTimer=null, editStData=null, editSchData=null;
let allClassIds = [];

// ▼▼▼ 認証チェック関数 ▼▼▼
const checkAuth = () => {
    const tid = sessionStorage.getItem('user_id');
    if (!tid || sessionStorage.getItem('user_role') !== 'teacher') {
        location.replace('../html/index.html');
        return false;
    }
    return true;
};

// ▼▼▼ ページが表示されるたびに実行 (戻るボタン対策) ▼▼▼
window.addEventListener('pageshow', (event) => {
    checkAuth();
});

document.addEventListener('DOMContentLoaded', async () => {
    if (!checkAuth()) return;

    const tid = sessionStorage.getItem('user_id');
    document.getElementById('teacherId').textContent = tid;
    
    const unread = sessionStorage.getItem('unread_count');
    if (unread && parseInt(unread) > 0) {
        alert(`🔔 新着メッセージが ${unread} 件あります`);
        sessionStorage.removeItem('unread_count');
    }

    await initData();
    setupEvents();
    
    const today = new Date().toISOString().split('T')[0];
    const now = new Date();
    document.getElementById('realtimeDate').value = today;
    document.getElementById('scheduleMonthInput').value = `${now.getFullYear()}-${('0'+(now.getMonth()+1)).slice(-2)}`;
    document.getElementById('calBaseDate').value = today;
    document.getElementById('absenceDateFilter').value = today;
    
    loadRealtime();
});

async function initData() {
    try {
        const r1 = await fetch(`${API_BASE_URL}/get_course_koma`);
        const d1 = await r1.json();
        courses=d1.courses; komas=d1.komas;
        
        const r2 = await fetch(`${API_BASE_URL}/get_class_list`);
        const d2 = await r2.json();
        
        allClassIds = d2.classes.map(c => c.class_id);

        const set = (id, list, k, v, empty=false) => {
            const el = document.getElementById(id); 
            if(!el) return;
            el.innerHTML = empty ? '<option value="0">(なし)</option>' : '';
            list.forEach(i => { const o=document.createElement('option'); o.value=i[k]; o.textContent=i[v]; el.appendChild(o); });
        };
        
        set('realtimeKoma', komas, 'koma_id', 'koma_name');
        set('schModalCourse', courses, 'course_id', 'course_name', true);
        set('schMultiCourseSelect', courses, 'course_id', 'course_name', true);
        set('stModalCourse', courses, 'course_id', 'course_name');
        set('stModalKoma', komas, 'koma_id', 'koma_name');

        const setCls = (id) => {
            const el = document.getElementById(id);
            if(!el) return;
            d2.classes.forEach(c => { const o=document.createElement('option'); o.value=c.class_id; o.textContent=`クラス${c.class_id}`; el.appendChild(o); });
        };
        ['realtimeClassFilter', 'scheduleClassSelect', 'calClassFilter', 'absenceClassFilter', 'chatClassFilter', 'studentCrudClassFilter'].forEach(setCls);
        
        const schSel = document.getElementById('scheduleClassSelect');
        if(schSel && schSel.options.length > 0) schSel.value = schSel.options[0].value;

        // ★追加: 現在時刻からコマを自動選択
        autoSelectCurrentKoma();
        
    } catch(e) { console.error("データ初期化エラー:", e); }
}

// ★修正: 休み時間に入ったら「次のコマ」を選択するロジック
function autoSelectCurrentKoma() {
    const now = new Date();
    const min = now.getHours() * 60 + now.getMinutes();
    let currentKoma = 1; // デフォルトは1限

    // 授業終了時刻を基準に切り替える
    // 1限終了: 10:45 (645分) → これを過ぎたら2限
    // 2限終了: 12:30 (750分) → これを過ぎたら3限
    // 3限終了: 15:00 (900分) → これを過ぎたら4限
    
    if (min < 645) currentKoma = 1;      // 〜 10:45 (1限中)
    else if (min < 750) currentKoma = 2; // 〜 12:30 (休み時間・2限中)
    else if (min < 900) currentKoma = 3; // 〜 15:00 (昼休み・3限中)
    else currentKoma = 4;                // 15:00 以降 (休み時間・4限・放課後)

    const komaSelect = document.getElementById('realtimeKoma');
    if (komaSelect) {
        komaSelect.value = currentKoma;
    }
}

function setupEvents() {
    document.getElementById('logoutButton').onclick = () => { 
        sessionStorage.clear(); 
        // ★変更: 履歴を残さずに移動
        location.replace('../html/index.html'); 
    };
    
    document.querySelectorAll('.tab-button').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.tab-button').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            document.querySelectorAll('.tab-content').forEach(c => c.style.display='none');
            document.getElementById(btn.dataset.tab).style.display='block';
            
            if(chatTimer) clearInterval(chatTimer);
            
            const tab = btn.dataset.tab;
            if(tab === 'chat-mgr') { loadChatStudents(); chatTimer=setInterval(loadChatHist,3000); }
            if(tab === 'schedule-mgr') loadSchedule();
            if(tab === 'student-attendance') loadCalStudents();
            if(tab === 'student-crud') loadStudentList();
            if(tab === 'teacher-crud') loadTeacherList();
        });
    });

    const refRt = document.getElementById('refreshRealtime');
    if(refRt) refRt.onclick = loadRealtime;

    const schCls = document.getElementById('scheduleClassSelect');
    if(schCls) schCls.onchange = loadSchedule;
    document.getElementById('scheduleMonthInput').onchange = loadSchedule;
    document.querySelectorAll('input[name="schMode"]').forEach(e => e.onchange = () => {
        document.getElementById('multiControls').style.display = e.value==='multi'?'inline':'none';
        schSel=[]; loadSchedule();
    });
    document.getElementById('schMultiApplyBtn').onclick = applyMultiSch;
    document.getElementById('schModalSave').onclick = saveSingleSch;
    document.getElementById('addCourseMasterBtn').onclick = async () => {
        const n = document.getElementById('newCourseName').value;
        if(n) await fetch(`${API_BASE_URL}/add_course_master`, {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({course_name:n})});
        alert('追加しました'); location.reload();
    };

    document.getElementById('calClassFilter').onchange = loadCalStudents;
    document.getElementById('showCalendarBtn').onclick = loadCalendar;
    document.getElementById('stModalSave').onclick = saveStatus;

    document.getElementById('studentCrudClassFilter').onchange = loadStudentList;

    // パスワード表示切替
    const setupToggle = (inputId, iconId) => {
        const inp = document.getElementById(inputId);
        const icon = document.getElementById(iconId);
        if(inp && icon) {
            icon.onclick = () => {
                if(inp.type === 'password') {
                    inp.type = 'text';
                    icon.textContent = '🙈'; 
                } else {
                    inp.type = 'password';
                    icon.textContent = '👁️'; 
                }
            };
        }
    };
    setupToggle('crudSPass', 'toggleSPass');
    setupToggle('crudTPass', 'toggleTPass');

    // クラス選択ロジック
    const crudSel = document.getElementById('crudSClassSelect');
    if(crudSel) {
        crudSel.onchange = () => {
            const inp = document.getElementById('crudSClassInput');
            if(crudSel.value === 'new') {
                inp.style.display = 'inline-block';
                inp.value = '';
                inp.focus();
            } else {
                inp.style.display = 'none';
            }
        };
    }

    // ▼▼▼ バリデーション (saveStudent) ▼▼▼
    window.saveStudent = async () => {
        const sid = document.getElementById('crudSid').value.trim();
        const sname = document.getElementById('crudSName').value.trim();
        
        let classIdVal = document.getElementById('crudSClassSelect').value;
        if(classIdVal === 'new') {
            classIdVal = document.getElementById('crudSClassInput').value.trim();
        }

        const gen = document.getElementById('crudSGen').value;
        const birth = document.getElementById('crudSBirth').value;
        const email = document.getElementById('crudSEmail').value.trim();
        const pass = document.getElementById('crudSPass').value; 

        // エラーチェック
        let errorMsg = [];
        if(!sid) errorMsg.push("・学籍番号を入力してください");
        // ★修正: 6桁チェックを追加
        else if(sid.length !== 6) errorMsg.push("・学籍番号は6桁で入力してください");
        
        if(!sname) errorMsg.push("・氏名を入力してください");
        if(!classIdVal) errorMsg.push("・クラスを選択または入力してください");
        if(!birth) errorMsg.push("・生年月日を入力してください");
        if(!email) errorMsg.push("・Emailを入力してください");
        if(!pass) errorMsg.push("・パスワードを入力してください");

        if(errorMsg.length > 0) {
            alert("【入力エラー】\n以下の項目を確認してください:\n\n" + errorMsg.join("\n"));
            return;
        }

        const body = {
            student_id: sid,
            student_name: sname,
            class_id: classIdVal,
            gender: gen, 
            birthday: birth,
            email: email,
            password: pass
        };

        try {
            const url = document.getElementById('crudSid').disabled ? 'update_student' : 'add_student';
            const res = await fetch(`${API_BASE_URL}/${url}`, {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body)});
            const ret = await res.json();
            
            if(ret.success) {
                alert("保存しました");
                location.reload();
            } else {
                alert("エラー: " + (ret.message || "保存できませんでした"));
            }
        } catch(e) {
            console.error(e);
            alert("通信エラーが発生しました");
        }
    };

    window.deleteStudent = async () => {
        if(!confirm('削除しますか？')) return;
        await fetch(`${API_BASE_URL}/delete_student`, {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({student_id:document.getElementById('crudSid').value})});
        document.getElementById('studentForm').style.display='none'; loadStudentList();
    };
    
    // ▼▼▼ バリデーション (saveTeacher) ▼▼▼
    window.saveTeacher = async () => {
        const tid = document.getElementById('crudTid').value.trim();
        const tname = document.getElementById('crudTName').value.trim();
        const email = document.getElementById('crudTEmail').value.trim();
        const pass = document.getElementById('crudTPass').value;

        let errorMsg = [];
        if(!tid) errorMsg.push("・教員IDを入力してください");
        if(!tname) errorMsg.push("・氏名を入力してください");
        if(!email) errorMsg.push("・Emailを入力してください");
        if(!pass) errorMsg.push("・パスワードを入力してください");

        if(errorMsg.length > 0) {
            alert("【入力エラー】\n以下の項目を確認してください:\n\n" + errorMsg.join("\n"));
            return;
        }

        const checkedClasses = [];
        document.querySelectorAll('#crudTClassCheckboxes input[type="checkbox"]:checked').forEach(cb => {
            checkedClasses.push(parseInt(cb.value));
        });

        const body = {
            teacher_id: tid,
            teacher_name: tname,
            email: email,
            password: pass,
            assigned_classes: checkedClasses
        };

        try {
            const url = document.getElementById('crudTid').disabled ? 'update_teacher' : 'add_teacher';
            const res = await fetch(`${API_BASE_URL}/${url}`, {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body)});
            const ret = await res.json();

            if(ret.success) {
                alert("保存しました");
                document.getElementById('teacherForm').style.display='none'; loadTeacherList();
            } else {
                alert("エラー: " + (ret.message || "保存できませんでした"));
            }
        } catch(e) {
            console.error(e);
            alert("通信エラーが発生しました");
        }
    };

    window.deleteTeacher = async () => {
        if(!confirm('削除しますか？')) return;
        await fetch(`${API_BASE_URL}/delete_teacher`, {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({teacher_id:document.getElementById('crudTid').value})});
        document.getElementById('teacherForm').style.display='none'; loadTeacherList();
    };

    document.getElementById('chatClassFilter').onchange = loadChatStudents;
    document.getElementById('chatStudentSelect').onchange = loadChatHist;
    
    // ▼▼▼ チャット送信ボタン (連打防止 & 空白対策) ▼▼▼
    document.getElementById('teacherSendChatButton').onclick = async () => {
        const btn = document.getElementById('teacherSendChatButton');
        // ★修正: .trim() を追加
        const txt = document.getElementById('teacherChatInput').value.trim();
        const sid = document.getElementById('chatStudentSelect').value;
        
        if(!txt||!sid) return;

        btn.disabled = true;

        try {
            await fetch(`${API_BASE_URL}/chat/send`, {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({sender_id:sessionStorage.getItem('user_id'), receiver_id:sid, content:txt})});
            document.getElementById('teacherChatInput').value=''; loadChatHist();
        } catch(e) {
            console.error(e);
            alert("送信エラー");
        } finally {
            btn.disabled = false;
        }
    };
    // ▲▲▲ 修正ここまで ▲▲▲

    document.getElementById('broadcastChatButton').onclick = () => {
        const container = document.getElementById('broadcastClassCheckboxes');
        container.innerHTML = '';
        allClassIds.forEach(clsId => {
            const label = document.createElement('label');
            label.style.display = 'block'; label.style.cursor = 'pointer'; label.style.marginBottom = '5px';
            label.innerHTML = `<input type="checkbox" value="${clsId}"> クラス${clsId}`;
            container.appendChild(label);
        });
        document.getElementById('broadcastModal').style.display = 'block';
    };

    document.getElementById('submitBroadcast').onclick = async () => {
        // ★修正: .trim() を追加
        const content = document.getElementById('broadcastInput').value.trim();
        const btn = document.getElementById('submitBroadcast');
        
        const selectedClasses = [];
        document.querySelectorAll('#broadcastClassCheckboxes input:checked').forEach(cb => {
            selectedClasses.push(parseInt(cb.value));
        });

        if (selectedClasses.length === 0) { alert('送信先のクラスを1つ以上選択してください'); return; }
        if (!content) { alert('メッセージを入力してください'); return; }
        
        btn.disabled = true;
        btn.textContent = '送信中...';

        try {
            const res = await fetch(`${API_BASE_URL}/chat/broadcast`, {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({
                    sender_id: sessionStorage.getItem('user_id'),
                    class_ids: selectedClasses,
                    content: content
                })
            });
            const d = await res.json();
            if (d.success) {
                alert(`送信完了 (${d.count}名)`);
                document.getElementById('broadcastInput').value = '';
                document.getElementById('broadcastModal').style.display = 'none';
                loadChatHist();
            } else {
                alert('送信失敗');
            }
        } catch (e) {
            console.error(e);
            alert('通信エラー');
        } finally {
            btn.disabled = false;
            btn.textContent = '送信';
        }
    };

    document.getElementById('refreshAbsenceReports').onclick = loadAbsence;
}

async function loadRealtime() {
    const url = `${API_BASE_URL}/realtime_status?koma=${document.getElementById('realtimeKoma').value}&date=${document.getElementById('realtimeDate').value}&class_id=${document.getElementById('realtimeClassFilter').value}`;
    const d = await (await fetch(url)).json();
    const tb = document.querySelector('#realtimeTable tbody'); 
    tb.innerHTML='';
    d.records.forEach(r => {
        let cls = r.attendance_status==='出席'?'status-present':(r.attendance_status==='欠席'?'status-absent':'');
        const cid = r.course_id || 0; 
        tb.innerHTML += `
            <tr>
                <td>${r.student_id}</td>
                <td>${r.student_name}</td>
                <td>${r.class_id||'-'}</td>
                <td>${r.course_name}</td>
                <td class="${cls}">${r.attendance_status}</td>
                <td>${r.time||'-'}</td>
                <td><button onclick="jumpToStudentDetail(${r.student_id}, '${r.class_id||''}')" style="background-color: #17a2b8;">詳細</button></td>
            </tr>`;
    });
}

// ★追加: リアルタイム画面から生徒詳細ページへ遷移する関数
window.jumpToStudentDetail = async (sid, classId) => {
    // 1. タブを「生徒別出席簿」に切り替え
    document.querySelectorAll('.tab-button').forEach(b => b.classList.remove('active'));
    const targetBtn = document.querySelector('.tab-button[data-tab="student-attendance"]');
    if(targetBtn) targetBtn.classList.add('active');
    
    document.querySelectorAll('.tab-content').forEach(c => c.style.display='none');
    const targetContent = document.getElementById('student-attendance');
    if(targetContent) targetContent.style.display='block';

    // 2. クラスフィルタを選択
    const classSelect = document.getElementById('calClassFilter');
    const targetClassStr = String(classId); // 文字列として比較
    
    // プルダウンにそのクラスが存在するか確認してからセット
    let classExists = false;
    for(let i=0; i<classSelect.options.length; i++){
        if(classSelect.options[i].value === targetClassStr){
            classExists = true;
            break;
        }
    }
    classSelect.value = classExists ? targetClassStr : 'all';

    // 3. 日付を同期 (リアルタイム画面の日付をカレンダーの基準日にセット)
    const rtDate = document.getElementById('realtimeDate').value;
    if(rtDate) document.getElementById('calBaseDate').value = rtDate;

    // 4. 生徒リストを再読み込み (awaitで完了を待つ)
    await loadCalStudents();

    // 5. 生徒を選択
    const studentSelect = document.getElementById('calStudentSelect');
    studentSelect.value = sid;

    // 6. カレンダーを表示
    loadCalendar();
};

async function loadCalStudents() {
    const cid = document.getElementById('calClassFilter').value;
    const r = await fetch(`${API_BASE_URL}/get_student_list?class_id=${cid}`);
    const d = await r.json();
    const s = document.getElementById('calStudentSelect'); 
    s.innerHTML = '<option value="">選択してください</option>'; // 初期値
    d.students.forEach(i=>{ const o=document.createElement('option'); o.value=i.student_id; o.textContent=i.student_name; s.appendChild(o); });
    
    // ★追加: リストを再読み込みしたら、表示中のカレンダーはクリアする
    document.getElementById('calendarContainer').innerHTML = '';
}

// カレンダー生成ロジック
async function loadCalendar() {
    const sid = document.getElementById('calStudentSelect').value;
    if(!sid) { alert("生徒を選択してください"); return; }
    
    const baseDate = new Date(document.getElementById('calBaseDate').value);
    const view = document.getElementById('calViewType').value;
    
    let s, e;
    
    if(view === 'week') {
        const day = baseDate.getDay(); 
        s = new Date(baseDate);
        s.setDate(baseDate.getDate() - day);
        e = new Date(s);
        e.setDate(s.getDate() + 6);
    } else {
        s = new Date(baseDate.getFullYear(), baseDate.getMonth(), 1);
        e = new Date(baseDate.getFullYear(), baseDate.getMonth() + 1, 0);
    }

    const format = (d) => `${d.getFullYear()}-${(d.getMonth()+1).toString().padStart(2,'0')}-${d.getDate().toString().padStart(2,'0')}`;
    const s_str = format(s);
    const e_str = format(e);

    const url = `${API_BASE_URL}/get_student_attendance_range?student_id=${sid}&start_date=${s_str}&end_date=${e_str}`;
    const res = await (await fetch(url)).json();
    
    let h = '<div class="month-calendar">';
    ['日','月','火','水','木','金','土'].forEach(x => h += `<div class="month-day-header">${x}</div>`);
    
    if(view === 'month') {
        for(let i=0; i<s.getDay(); i++) h += '<div></div>';
    }

    let loopDate = new Date(s);
    while(loopDate <= e) {
        const dt = format(loopDate);
        const dayNum = loopDate.getDate();
        
        let b = '';
        const todayRecs = res.records.filter(r => r.attendance_date === dt);
        todayRecs.sort((a,b) => a.koma - b.koma);

        todayRecs.forEach(r => {
            let c = r.status_id == 1 ? 'bg-present' : (r.status_id == 3 ? 'bg-absent' : 'bg-late');
            b += `<div class="mini-badge ${c}" onclick="openStModal(${sid},'',${r.course_id},${r.koma},'${dt}')">${r.koma}:${r.status_text}</div>`;
        });
        
        h += `<div class="month-day" style="min-height:80px;">
                <div style="display:flex; justify-content:space-between;">
                  <span class="day-number">${dayNum}</span>
                  <span style="cursor:pointer; color:blue; font-weight:bold;" onclick="openStModal(${sid}, '', 0, 0, '${dt}')">＋</span>
                </div>
                ${b}
              </div>`;
        
        loopDate.setDate(loopDate.getDate() + 1);
    }
    
    document.getElementById('calendarContainer').innerHTML = h + '</div>';
}

window.openStModal = (sid, name, cid, koma, date) => {
    editStData = {sid, date};
    document.getElementById('stModalInfo').textContent = `${date} ${name}`;
    const cs = document.getElementById('stModalCourse');
    const ks = document.getElementById('stModalKoma');
    if(cid && cid !== 0 && cid !== '0') cs.value = cid; else if(cs.options.length > 0) cs.selectedIndex = 0;
    if(koma && koma !== 0) { ks.value = koma; ks.disabled = true; } else { ks.disabled = false; ks.selectedIndex = 0; }
    document.getElementById('statusChangeModal').style.display='block';
};

async function saveStatus() {
    const st = document.getElementById('stModalSelect').value;
    const cid = document.getElementById('stModalCourse').value;
    const ks = document.getElementById('stModalKoma');
    const komaVal = ks.value;
    if(!cid || cid === '0') { alert("授業を選択してください"); return; }
    if(!komaVal) { alert("コマを選択してください"); return; }
    await fetch(`${API_BASE_URL}/update_attendance_status`, {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({student_id:editStData.sid, course_id:cid, koma:komaVal, date:editStData.date, status_id:st})});
    document.getElementById('statusChangeModal').style.display='none';
    if(document.getElementById('student-attendance').style.display!=='none') loadCalendar(); else loadRealtime();
}

async function loadSchedule() {
    const ym = document.getElementById('scheduleMonthInput').value.split('-');
    const cls = document.getElementById('scheduleClassSelect').value;
    if(!cls) return; 
    const r = await fetch(`${API_BASE_URL}/get_monthly_schedule?class_id=${cls}&year=${ym[0]}&month=${ym[1]}`);
    const d = await r.json();
    const s = new Date(ym[0], ym[1]-1, 1); const e = new Date(ym[0], ym[1], 0);
    let h = '<div class="month-calendar">';
    ['日','月','火','水','木','金','土'].forEach(x=>h+=`<div class="month-day-header">${x}</div>`);
    const mode = document.querySelector('input[name="schMode"]:checked').value;
    for(let i=0; i<s.getDay(); i++) h+='<div></div>';
    for(let i=1; i<=e.getDate(); i++) {
        const dt = `${ym[0]}-${ym[1].toString().padStart(2,'0')}-${i.toString().padStart(2,'0')}`;
        let slots = '';
        for(let k=1; k<=4; k++) {
            const item = d.schedule.find(x=>x.schedule_date===dt && x.koma===k);
            const name = item ? item.course_name : '-';
            const bg = item ? '#e3f2fd' : '#f9f9f9';
            const border = schSel.find(x=>x.date===dt && x.koma===k) ? '2px solid orange' : '1px solid #ddd';
            const act = mode==='single' ? `openSchEdit(${cls},'${dt}',${k})` : `toggleSlot(this,'${dt}',${k})`;
            slots+=`<div class="mini-badge" style="background:${bg}; border:${border}; cursor:pointer;" onclick="${act}">${k}:${name}</div>`;
        }
        h+=`<div class="month-day"><span class="day-number">${i}</span>${slots}</div>`;
    }
    document.getElementById('scheduleCalendarWrapper').innerHTML = h+'</div>';
}
window.toggleSlot = (el, d, k) => {
    const idx = schSel.findIndex(x=>x.date===d && x.koma===k);
    if(idx>=0) schSel.splice(idx,1); else schSel.push({date:d, koma:k});
    loadSchedule();
};
window.openSchEdit = (cls, d, k) => {
    editSchData = {cls, d, k};
    document.getElementById('schModalInfo').textContent = `${d} ${k}限`;
    document.getElementById('schEditModal').style.display='block';
};
async function saveSingleSch() {
    const cid = document.getElementById('schModalCourse').value;
    await fetch(`${API_BASE_URL}/update_schedule_date`, {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({class_id:editSchData.cls, updates:[{date:editSchData.d, koma:editSchData.k, course_id:cid}]})});
    document.getElementById('schEditModal').style.display='none'; loadSchedule();
}
async function applyMultiSch() {
    const cid = document.getElementById('schMultiCourseSelect').value;
    const ups = schSel.map(s=>({date:s.date, koma:s.koma, course_id:cid}));
    await fetch(`${API_BASE_URL}/update_schedule_date`, {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({class_id:document.getElementById('scheduleClassSelect').value, updates:ups})});
    schSel=[]; loadSchedule();
}

// クラスフィルタ対応
async function loadStudentList() {
    const clsFilter = document.getElementById('studentCrudClassFilter').value;
    const url = `${API_BASE_URL}/get_student_list` + (clsFilter !== 'all' ? `?class_id=${clsFilter}` : '');
    
    const r=await fetch(url); 
    const d=await r.json(); 
    students=d.students;
    const tb=document.querySelector('#studentListTable tbody'); tb.innerHTML='';
    students.forEach(s=>tb.innerHTML+=`<tr><td>${s.student_id}</td><td>${s.student_name}</td><td>${s.class_id}</td><td>${s.email||''}</td><td><button onclick="openStudentForm(${s.student_id})">編集</button></td></tr>`);
}

window.openStudentForm = (id) => {
    document.getElementById('studentForm').style.display='block';
    
    // クラスプルダウンの生成ロジック
    const sel = document.getElementById('crudSClassSelect');
    const inp = document.getElementById('crudSClassInput');
    sel.innerHTML = '';
    
    // 既存のクラスを追加
    if(allClassIds && allClassIds.length > 0) {
        allClassIds.forEach(c => {
            const o = document.createElement('option');
            o.value = c;
            o.textContent = `クラス${c}`;
            sel.appendChild(o);
        });
    }
    
    // 新規追加オプションを追加
    const newOp = document.createElement('option');
    newOp.value = 'new';
    newOp.textContent = '＋ 新規クラス追加';
    sel.appendChild(newOp);
    
    // 入力欄は最初は隠す
    inp.style.display = 'none';
    inp.value = '';

    if(id) {
        const s = students.find(x=>x.student_id==id);
        document.getElementById('crudSid').value=s.student_id; document.getElementById('crudSid').disabled=true;
        document.getElementById('crudSName').value=s.student_name; 
        
        // クラス選択状態を復元
        if(s.class_id) { sel.value = s.class_id; } else { sel.selectedIndex = 0; }

        document.getElementById('crudSGen').value = s.gender || '設定しない';
        document.getElementById('crudSBirth').value=s.birthday;
        document.getElementById('crudSEmail').value=s.email;
        
        // パスワードの復元
        const p = document.getElementById('crudSPass');
        p.value = s.password || ''; 
        p.type = 'password';
        document.getElementById('toggleSPass').textContent = '👁️';
    } else {
        document.getElementById('crudSid').disabled=false; document.getElementById('crudSid').value='';
        sel.selectedIndex = 0;
        document.getElementById('crudSGen').value = '設定しない';
        
        // 新規時の初期パスワード
        const p = document.getElementById('crudSPass');
        p.value = 'password';
        p.type = 'password';
        document.getElementById('toggleSPass').textContent = '👁️';
    }
};

async function loadTeacherList() {
    const r=await fetch(`${API_BASE_URL}/get_teacher_list`); const d=await r.json(); teachers=d.teachers;
    const tb=document.querySelector('#teacherListTable tbody'); tb.innerHTML='';
    teachers.forEach(t => {
        const clsStr = (t.assigned_classes && t.assigned_classes.length > 0) ? t.assigned_classes.join(', ') : '-';
        tb.innerHTML += `<tr><td>${t.teacher_id}</td><td>${t.teacher_name}</td><td>${clsStr}</td><td>${t.email||''}</td><td><button onclick="openTeacherForm('${t.teacher_id}')">編集</button></td></tr>`;
    });
}
window.openTeacherForm = (id) => {
    document.getElementById('teacherForm').style.display='block';
    const container = document.getElementById('crudTClassCheckboxes');
    container.innerHTML = '';
    allClassIds.forEach(clsId => {
        const label = document.createElement('label');
        label.style.display = 'block'; label.style.cursor = 'pointer';
        label.innerHTML = `<input type="checkbox" value="${clsId}"> クラス${clsId}`;
        container.appendChild(label);
    });
    
    const p = document.getElementById('crudTPass');
    const icon = document.getElementById('toggleTPass');
    p.type = 'password';
    icon.textContent = '👁️';

    if(id) {
        const t = teachers.find(x=>x.teacher_id==id);
        document.getElementById('crudTid').value=t.teacher_id; document.getElementById('crudTid').disabled=true;
        document.getElementById('crudTName').value=t.teacher_name; document.getElementById('crudTEmail').value=t.email;
        if(t.assigned_classes) { t.assigned_classes.forEach(cid => { const cb = container.querySelector(`input[value="${cid}"]`); if(cb) cb.checked = true; }); }
        
        // パスワードの復元
        p.value = t.password || ''; 
    } else {
        document.getElementById('crudTid').disabled=false; document.getElementById('crudTid').value='';
        // 新規時の初期パスワード
        p.value = 'password';
    }
};

async function loadChatStudents() {
    const cid = document.getElementById('chatClassFilter').value;
    const r = await fetch(`${API_BASE_URL}/get_student_list?class_id=${cid}`);
    const d = await r.json();
    const s = document.getElementById('chatStudentSelect'); s.innerHTML='';
    const placeholder = document.createElement('option'); placeholder.value=''; placeholder.textContent='選択してください'; s.appendChild(placeholder);
    d.students.forEach(i=>{ const o=document.createElement('option'); o.value=i.student_id; o.textContent=i.student_name; s.appendChild(o); });
    loadChatHist();
}
async function loadChatHist() {
    const sid = document.getElementById('chatStudentSelect').value;
    if(!sid) return;
    const r = await fetch(`${API_BASE_URL}/chat/history?user1=${sessionStorage.getItem('user_id')}&user2=${sid}`);
    const d = await r.json();
    const w = document.getElementById('teacherChatWindow'); w.innerHTML='';
    d.messages.forEach(m=>{ w.innerHTML+=`<div class="message-bubble ${m.sender_id==sessionStorage.getItem('user_id')?'mine':'theirs'}"><div>${m.message_content}</div><div class="message-time">${m.time}</div></div>`; });
    w.scrollTop=w.scrollHeight;
}

async function loadAbsence() {
    const url = `${API_BASE_URL}/get_absence_reports?date=${document.getElementById('absenceDateFilter').value}&class_id=${document.getElementById('absenceClassFilter').value}`;
    const r = await fetch(url); 
    const d = await r.json();
    const tb = document.querySelector('#absenceTable tbody'); 
    tb.innerHTML = '';

    const groups = {};
    d.reports.forEach(row => {
        const key = `${row.attendance_date}_${row.student_id}`;
        if (!groups[key]) {
            groups[key] = {
                date: row.attendance_date,
                name: row.student_name,
                reason: row.reason, 
                details: []
            };
        }
        groups[key].details.push(row);
    });

    Object.keys(groups).forEach((key, index) => {
        const g = groups[key];
        const rowId = `detail-${index}`;
        const komaSummary = g.details.map(d => d.koma).join(', ') + '限';

        tb.innerHTML += `
            <tr class="parent-row" style="background-color: #fff;">
                <td>${g.date}</td>
                <td>${g.name}</td>
                <td>${komaSummary}</td>
                <td>${g.reason}</td>
                <td style="text-align:center;">
                    <button onclick="toggleDetail('${rowId}')" style="font-size:12px; padding:2px 8px;">詳細</button>
                </td>
            </tr>`;

        let detailHtml = `
            <tr id="${rowId}" style="display:none; background-color: #f9f9f9;">
                <td colspan="5" style="padding: 10px 20px;">
                    <table style="width:100%; border:1px solid #ddd; background:#fff;">
                        <thead style="background:#eee;">
                            <tr>
                                <th style="padding:5px;">コマ</th>
                                <th style="padding:5px;">授業</th>
                                <th style="padding:5px;">状態</th>
                            </tr>
                        </thead>
                        <tbody>`;
        
        g.details.forEach(item => {
            detailHtml += `
                <tr>
                    <td style="padding:5px; border-bottom:1px solid #eee;">${item.koma}限</td>
                    <td style="padding:5px; border-bottom:1px solid #eee;">${item.course_name}</td>
                    <td style="padding:5px; border-bottom:1px solid #eee;">${item.status_name}</td>
                </tr>`;
        });

        detailHtml += `</tbody></table></td></tr>`;
        tb.innerHTML += detailHtml;
    });
}

window.toggleDetail = (id) => {
    const row = document.getElementById(id);
    if (row.style.display === 'none') {
        row.style.display = 'table-row';
    } else {
        row.style.display = 'none';
    }
};