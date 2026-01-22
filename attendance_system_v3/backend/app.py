#-*- coding:utf-8 -*-
from flask import Flask, request, jsonify, redirect
from flask_cors import CORS
from flask_basicauth import BasicAuth
from db import execute_query
import datetime
from datetime import timedelta
import math
import numpy as np
import json
import smtplib
from email.mime.text import MIMEText
from email.utils import formatdate
from config import API_BASE_URL, FACE_MATCH_THRESHOLD, SCHOOL_LOCATION, ALLOWED_RADIUS_METERS, EMAIL_CONFIG
import os
import traceback

# ==========================================
# ▼▼▼ フォルダ位置の設定 ▼▼▼
# ==========================================
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
FRONTEND_DIR = os.path.abspath(os.path.join(BASE_DIR, '..', 'frontend'))

print("\n" + "="*40)
print(f"Backend  Path: {BASE_DIR}")
print(f"Frontend Path: {FRONTEND_DIR}")
print("="*40 + "\n")

app = Flask(__name__, static_folder=FRONTEND_DIR, static_url_path='')
CORS(app)

# ==========================================
# ▼▼▼ Basic認証の設定 ▼▼▼
# ==========================================
app.config['BASIC_AUTH_USERNAME'] = 'admin'        # ユーザー名
app.config['BASIC_AUTH_PASSWORD'] = 'sotsuken2026' # パスワード
app.config['BASIC_AUTH_FORCE'] = True
basic_auth = BasicAuth(app)

# ==========================================
# ▼▼▼ 定数リスト ▼▼▼
# ==========================================
STATUS_NAMES = {
    1: "出席",
    2: "遅刻",
    3: "欠席",
    4: "早退"
}

PERIOD_START_TIMES = { 
    1: "09:10", 
    2: "11:00", 
    3: "13:30", 
    4: "15:15" 
}

# ==========================================
# ▼▼▼ ルート設定 ▼▼▼
# ==========================================
@app.route('/')
def index():
    return redirect('/html/index.html')

# --- メール送信 (SSL) ---
def send_email(to_email, subject, body):
    if not to_email or 'xxxx' in EMAIL_CONFIG['password']:
        print(f"[Mail Mock] To:{to_email}\nSubject:{subject}\nBody:{body}\n----------------")
        return
    try:
        msg = MIMEText(body)
        msg['Subject'] = subject
        msg['From'] = EMAIL_CONFIG['sender_email']
        msg['To'] = to_email
        msg['Date'] = formatdate()
        
        smtp = smtplib.SMTP_SSL(EMAIL_CONFIG['smtp_server'], EMAIL_CONFIG['smtp_port'])
        smtp.login(EMAIL_CONFIG['sender_email'], EMAIL_CONFIG['password'])
        smtp.send_message(msg)
        smtp.close()
        print(f"Mail sent to {to_email}")
    except Exception as e:
        print(f"Mail Error: {e}")

# --- 距離計算 ---
def calc_geo_distance(lat1, lon1, lat2, lon2):
    R = 6371000 # 地球の半径(m)
    phi1 = math.radians(lat1)
    phi2 = math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlam = math.radians(lon2 - lon1)
    
    a = math.sin(dphi/2)**2 + math.cos(phi1)*math.cos(phi2)*math.sin(dlam/2)**2
    return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1-a))

def calc_face_distance(vec1, vec2):
    return np.linalg.norm(np.array(vec1) - np.array(vec2))

# --- API ---
@app.route(f'{API_BASE_URL}/login', methods=['POST'])
def login():
    try:
        d = request.json
        u = str(d.get('id')).strip()
        p = str(d.get('password')).strip()
        print(f"Login Attempt: ID=[{u}]")

        teacher = execute_query("SELECT teacher_id FROM teachers WHERE teacher_id=%s AND password=%s", (u, p), fetch=True)
        if teacher:
            unread_res = execute_query("SELECT COUNT(*) as c FROM chat_messages WHERE receiver_id=%s AND is_read=0", (u,), fetch=True)
            unread = unread_res[0]['c'] if unread_res else 0
            return jsonify({'success': True, 'role': 'teacher', 'user_id': u, 'unread_count': unread})

        student = execute_query("SELECT s.student_id, s.class_id FROM students s JOIN student_auth sa ON s.student_id=sa.student_id WHERE s.student_id=%s AND sa.password=%s", (u, p), fetch=True)
        if student:
            unread_res = execute_query("SELECT COUNT(*) as c FROM chat_messages WHERE receiver_id=%s AND is_read=0", (u,), fetch=True)
            unread = unread_res[0]['c'] if unread_res else 0
            return jsonify({'success': True, 'role': 'student', 'user_id': u, 'class_id': student[0]['class_id'], 'unread_count': unread})

        return jsonify({'success': False, 'message': 'IDまたはパスワードが間違っています'}), 401
    except Exception as e:
        traceback.print_exc()
        return jsonify({'success': False, 'message': 'サーバーエラー'}), 500

@app.route(f'{API_BASE_URL}/get_student_info')
def get_student_info():
    res = execute_query("SELECT student_name, class_id FROM students WHERE student_id=%s", (request.args.get('student_id'),), fetch=True)
    return jsonify({'success': True, 'student': res[0]}) if res else jsonify({'success': False})

@app.route(f'{API_BASE_URL}/get_course_koma')
def get_course_koma():
    c = execute_query("SELECT * FROM courses", fetch=True)
    return jsonify({'success': True, 'courses': c, 'komas': [{'koma_id': i, 'koma_name': f'{i}限'} for i in range(1,5)]})

@app.route(f'{API_BASE_URL}/register_face', methods=['POST'])
def register_face():
    try:
        d = request.json
        sid, desc = d.get('student_id'), d.get('descriptor')
        if not sid or not desc: return jsonify({'success': False}), 400
        execute_query("UPDATE student_auth SET face_encoding=%s WHERE student_id=%s", (json.dumps(desc), sid))
        return jsonify({'success': True})
    except Exception as e:
        traceback.print_exc()
        return jsonify({'success': False, 'message': str(e)}), 500

@app.route(f'{API_BASE_URL}/check_in', methods=['POST'])
def check_in():
    try:
        d = request.json
        print(f"Check-in Request: {d}")

        sid = d.get('student_id')
        desc = d.get('descriptor')
        cid = d.get('course_id')
        koma = d.get('koma')
        lat = d.get('lat')
        lng = d.get('lng')

        if not sid or not desc:
            return jsonify({'success': False, 'message': '認証データが不足しています'}), 400
        if not cid or not koma:
            return jsonify({'success': False, 'message': '授業と時限(コマ)を選択してください'}), 400
        if lat is None or lng is None:
            return jsonify({'success': False, 'message': '位置情報が取得できていません'}), 400

        try:
            koma = int(koma)
            lat = float(lat)
            lng = float(lng)
        except (ValueError, TypeError) as e:
            print(f"Data conversion error: {e}")
            return jsonify({'success': False, 'message': 'データの形式が正しくありません'}), 400

        dist = calc_geo_distance(lat, lng, SCHOOL_LOCATION['lat'], SCHOOL_LOCATION['lng'])
        print(f"Distance: {dist}m")
        if dist > ALLOWED_RADIUS_METERS:
            return jsonify({'success': False, 'message': f'学校の範囲外です (距離: {int(dist)}m)'}), 400

        auth = execute_query("SELECT face_encoding FROM student_auth WHERE student_id=%s", (sid,), fetch=True)
        if not auth or not auth[0]['face_encoding']:
            return jsonify({'success': False, 'message': '顔データが登録されていません'}), 400
        
        reg_vec = json.loads(auth[0]['face_encoding'])
        face_dist = calc_face_distance(desc, reg_vec)
        print(f"Face Distance: {face_dist}")
        
        if face_dist > FACE_MATCH_THRESHOLD:
            return jsonify({'success': False, 'message': '顔が一致しません'}), 401

        now = datetime.datetime.now()
        today = datetime.date.today().isoformat()
        
        start_str = PERIOD_START_TIMES.get(int(koma), "00:00")
        start_dt = datetime.datetime.combine(datetime.date.today(), datetime.datetime.strptime(start_str, "%H:%M").time())
        
        st_id = 1
        if now > start_dt + timedelta(minutes=30): st_id = 3
        elif now > start_dt: st_id = 2

        exist = execute_query("SELECT * FROM attendance_records WHERE student_id=%s AND attendance_date=%s AND koma=%s", (sid, today, koma), fetch=True)
        
        if exist:
            status_now = STATUS_NAMES.get(exist[0]['status_id'], '登録済')
            c_info = execute_query("SELECT course_name FROM courses WHERE course_id=%s", (exist[0]['course_id'],), fetch=True)
            existing_course_name = c_info[0]['course_name'] if c_info else "不明な授業"
            return jsonify({'success': False, 'message': f'すでに{koma}限は「{existing_course_name}」で登録されています'}), 400
        else:
            execute_query("INSERT INTO attendance_records (student_id, attendance_date, course_id, koma, status_id, attendance_time) VALUES (%s,%s,%s,%s,%s,%s)", (sid, today, cid, koma, st_id, now.strftime('%H:%M:%S')))
        
        return jsonify({'success': True, 'message': '出席を受け付けました'})

    except Exception as e:
        traceback.print_exc()
        return jsonify({'success': False, 'message': f'サーバーエラー: {str(e)}'}), 500

@app.route(f'{API_BASE_URL}/report_absence', methods=['POST'])
def report_absence():
    d = request.json
    sid = d.get('student_id')
    date = d.get('absence_date')
    reports = d.get('reports', []) 
    reason = d.get('reason')

    if not sid or not date or not reports: return jsonify({'success': False, 'message': 'データ不足'}), 400

    s_info = execute_query("SELECT student_name, class_id FROM students WHERE student_id=%s", (sid,), fetch=True)
    if not s_info: return jsonify({'success': False, 'message': '生徒不明'}), 400
    
    student_name = s_info[0]['student_name']
    class_id = s_info[0]['class_id']

    mail_details = [] 
    count = 0
    skipped_count = 0 

    for item in reports:
        k = item['koma']
        st_id = item['status']
        st_name = STATUS_NAMES.get(st_id, "その他")
        
        course_id = None
        course_name = "(授業なし)"
        if class_id:
            sch = execute_query("SELECT cs.course_id, c.course_name FROM class_schedule cs JOIN courses c ON cs.course_id=c.course_id WHERE cs.class_id=%s AND cs.schedule_date=%s AND cs.koma=%s", (class_id, date, k), fetch=True)
            if sch:
                course_id = sch[0]['course_id']
                course_name = sch[0]['course_name']
        
        # 重複チェック (Frontend側でも行うがBackendでも一応スキップ処理)
        exist = execute_query("SELECT record_id, status_id FROM attendance_records WHERE student_id=%s AND attendance_date=%s AND koma=%s", (sid, date, k), fetch=True)
        
        if exist:
            print(f"Skip duplicate: {date} Koma {k} is already {exist[0]['status_id']}")
            skipped_count += 1
            continue 

        # ▼▼▼ メール本文用リストに追加（ここがループ内にあるので全件追加される） ▼▼▼
        mail_details.append(f"・{k}限 ({course_name}): {st_name}")
        
        execute_query("INSERT INTO attendance_records (student_id, attendance_date, course_id, koma, status_id, reason) VALUES (%s,%s,%s,%s,%s,%s)", (sid, date, course_id, k, st_id, reason))
        count += 1

    # メール送信（1回だけ送信）
    if count > 0 and class_id:
        teachers_to_notify = execute_query("SELECT t.email, t.teacher_name FROM teachers t JOIN teacher_assignments ta ON t.teacher_id = ta.teacher_id WHERE ta.class_id=%s", (class_id,), fetch=True)
        
        if teachers_to_notify:
            subject = f"【欠席連絡】{student_name} (クラス{class_id})"
            body_base = f"先生\n\nクラス{class_id}の {student_name} さんから欠席等の連絡がありました。\n\n"
            body_base += f"■対象日: {date}\n"
            # ▼▼▼ ここでリストを結合して本文にする ▼▼▼
            body_base += "■内容:\n" + "\n".join(mail_details) + "\n\n"
            body_base += f"■理由:\n{reason}\n\n"
            body_base += "出席管理システムより自動送信"

            for t in teachers_to_notify:
                if t['email']:
                    body = f"{t['teacher_name']} " + body_base
                    send_email(t['email'], subject, body)

    msg = f'{count}件の連絡を受け付けました'
    if skipped_count > 0:
        msg += f'（{skipped_count}件は登録済みのためスキップされました）'

    return jsonify({'success': True, 'count': count, 'message': msg})

@app.route(f'{API_BASE_URL}/student_records')
def student_records():
    res = execute_query("SELECT ar.attendance_date, ar.koma, c.course_name, ar.attendance_time, sc.status_name as attendance_status FROM attendance_records ar LEFT JOIN courses c ON ar.course_id=c.course_id JOIN status_codes sc ON ar.status_id=sc.status_id WHERE ar.student_id=%s ORDER BY ar.attendance_date DESC, ar.koma DESC", (request.args.get('student_id'),), fetch=True)
    for r in res:
        if r['attendance_date']: r['attendance_date'] = r['attendance_date'].isoformat()
        # ★重要修正: 時間が00:00:00でも文字列化する
        if r['attendance_time'] is not None: r['attendance_time'] = str(r['attendance_time'])
        if not r['course_name']: r['course_name'] = '-'
    return jsonify({'success': True, 'records': res or []})

@app.route(f'{API_BASE_URL}/realtime_status')
def realtime_status():
    k, dt, cls = request.args.get('koma'), request.args.get('date'), request.args.get('class_id')
    q = """
        SELECT s.student_id, s.student_name, s.class_id, ar.attendance_time as time, sc.status_name as attendance_status,
        COALESCE(c_actual.course_name, c_sched.course_name) as course_name, COALESCE(ar.course_id, cs.course_id) as course_id
        FROM students s 
        LEFT JOIN attendance_records ar ON s.student_id=ar.student_id AND ar.attendance_date=%s AND ar.koma=%s 
        LEFT JOIN courses c_actual ON ar.course_id = c_actual.course_id
        LEFT JOIN status_codes sc ON ar.status_id=sc.status_id
        LEFT JOIN class_schedule cs ON s.class_id = cs.class_id AND cs.schedule_date = %s AND cs.koma = %s
        LEFT JOIN courses c_sched ON cs.course_id = c_sched.course_id
    """
    p = [dt, k, dt, k]
    if cls and cls != 'all': q += " WHERE s.class_id=%s"; p.append(cls)
    res = execute_query(q + " ORDER BY s.student_id", tuple(p), fetch=True)
    for r in res:
        # ★重要修正: 時間が00:00:00でも文字列化する
        if r['time'] is not None: r['time'] = str(r['time'])
        if not r['attendance_status']: r['attendance_status'] = '未出席'
        if not r['course_name']: r['course_name'] = '-'
    return jsonify({'success': True, 'records': res})

@app.route(f'{API_BASE_URL}/update_attendance_status', methods=['POST'])
def update_attendance_status():
    d = request.json
    exist = execute_query("SELECT record_id FROM attendance_records WHERE student_id=%s AND attendance_date=%s AND koma=%s", (d['student_id'], d['date'], d['koma']), fetch=True)
    if exist:
        execute_query("UPDATE attendance_records SET status_id=%s, course_id=%s WHERE record_id=%s", (d['status_id'], d['course_id'], exist[0]['record_id']))
    else:
        execute_query("INSERT INTO attendance_records (student_id, attendance_date, course_id, koma, status_id, attendance_time) VALUES (%s,%s,%s,%s,%s,%s)", (d['student_id'], d['date'], d['course_id'], d['koma'], d['status_id'], datetime.datetime.now().strftime('%H:%M:%S')))
    return jsonify({'success': True})

@app.route(f'{API_BASE_URL}/get_student_list')
def get_student_list():
    cls = request.args.get('class_id')
    q = "SELECT s.*, sa.password FROM students s LEFT JOIN student_auth sa ON s.student_id=sa.student_id"
    
    if cls and cls!='all':
        q += " WHERE s.class_id=%s"
        res = execute_query(q, (cls,), fetch=True)
    else:
        res = execute_query(q, (), fetch=True)
        
    for r in res: r['birthday'] = r['birthday'].isoformat() if r['birthday'] else ''
    return jsonify({'success': True, 'students': res})

@app.route(f'{API_BASE_URL}/add_student', methods=['POST'])
def add_student():
    d=request.json
    if not d.get('student_id') or not d.get('student_name') or not d.get('class_id') or not d.get('gender') or not d.get('birthday') or not d.get('email') or not d.get('password'):
         return jsonify({'success': False, 'message': '全ての項目を入力してください'}), 400

    if execute_query("INSERT INTO students (student_id, student_name, class_id, gender, birthday, email) VALUES (%s,%s,%s,%s,%s,%s)", (d['student_id'], d['student_name'], d.get('class_id'), d.get('gender'), d.get('birthday'), d.get('email'))):
        execute_query("INSERT INTO student_auth (student_id, password) VALUES (%s,%s)", (d['student_id'], d['password']))
        return jsonify({'success': True})
    return jsonify({'success': False})

@app.route(f'{API_BASE_URL}/update_student', methods=['POST'])
def update_student():
    d=request.json
    if not d.get('student_name') or not d.get('class_id') or not d.get('gender') or not d.get('birthday') or not d.get('email'):
         return jsonify({'success': False, 'message': '全ての項目を入力してください'}), 400

    execute_query("UPDATE students SET student_name=%s, class_id=%s, gender=%s, birthday=%s, email=%s WHERE student_id=%s", (d['student_name'], d['class_id'], d['gender'], d['birthday'], d.get('email'), d['student_id']))
    if d.get('password'): execute_query("UPDATE student_auth SET password=%s WHERE student_id=%s", (d['password'], d['student_id']))
    return jsonify({'success': True})

@app.route(f'{API_BASE_URL}/delete_student', methods=['POST'])
def delete_student():
    execute_query("DELETE FROM students WHERE student_id=%s", (request.json['student_id'],))
    return jsonify({'success': True})

@app.route(f'{API_BASE_URL}/get_teacher_list')
def get_teacher_list():
    q = """SELECT t.*, GROUP_CONCAT(ta.class_id) as assigned_classes FROM teachers t LEFT JOIN teacher_assignments ta ON t.teacher_id = ta.teacher_id GROUP BY t.teacher_id"""
    teachers = execute_query(q, fetch=True)
    for t in teachers:
        t['assigned_classes'] = [int(x) for x in str(t['assigned_classes']).split(',')] if t['assigned_classes'] else []
    return jsonify({'success': True, 'teachers': teachers})

@app.route(f'{API_BASE_URL}/add_teacher', methods=['POST'])
def add_teacher():
    d = request.json
    if not d.get('teacher_id') or not d.get('teacher_name') or not d.get('email') or not d.get('password'):
        return jsonify({'success': False, 'message': '全ての項目を入力してください'}), 400

    if execute_query("INSERT INTO teachers (teacher_id, password, teacher_name, email) VALUES (%s,%s,%s,%s)", (d['teacher_id'], d['password'], d['teacher_name'], d.get('email'))):
        if d.get('assigned_classes'):
            for cid in d['assigned_classes']:
                execute_query("INSERT INTO teacher_assignments (teacher_id, class_id) VALUES (%s, %s)", (d['teacher_id'], cid))
        return jsonify({'success': True})
    return jsonify({'success': False})

@app.route(f'{API_BASE_URL}/update_teacher', methods=['POST'])
def update_teacher():
    d = request.json
    if not d.get('teacher_name') or not d.get('email'):
        return jsonify({'success': False, 'message': '全ての項目を入力してください'}), 400

    execute_query("UPDATE teachers SET teacher_name=%s, email=%s WHERE teacher_id=%s", (d['teacher_name'], d.get('email'), d['teacher_id']))
    if d.get('password'): 
        execute_query("UPDATE teachers SET password=%s WHERE teacher_id=%s", (d['password'], d['teacher_id']))
    
    execute_query("DELETE FROM teacher_assignments WHERE teacher_id=%s", (d['teacher_id'],))
    if d.get('assigned_classes'):
        for cid in d['assigned_classes']:
            execute_query("INSERT INTO teacher_assignments (teacher_id, class_id) VALUES (%s, %s)", (d['teacher_id'], cid))
    return jsonify({'success': True})

@app.route(f'{API_BASE_URL}/delete_teacher', methods=['POST'])
def delete_teacher():
    return jsonify({'success': execute_query("DELETE FROM teachers WHERE teacher_id=%s", (request.json['teacher_id'],)) is not None})

@app.route(f'{API_BASE_URL}/get_class_list')
def get_class_list():
    return jsonify({'success': True, 'classes': execute_query("SELECT DISTINCT class_id FROM students WHERE class_id IS NOT NULL ORDER BY class_id", fetch=True)})

@app.route(f'{API_BASE_URL}/get_monthly_schedule')
def get_monthly_schedule():
    res = execute_query("SELECT cs.schedule_date, cs.koma, cs.course_id, c.course_name FROM class_schedule cs JOIN courses c ON cs.course_id=c.course_id WHERE cs.class_id=%s AND YEAR(cs.schedule_date)=%s AND MONTH(cs.schedule_date)=%s", (request.args.get('class_id'), request.args.get('year'), request.args.get('month')), fetch=True)
    for r in res: r['schedule_date'] = r['schedule_date'].isoformat()
    return jsonify({'success': True, 'schedule': res})

@app.route(f'{API_BASE_URL}/get_today_schedule')
def get_today_schedule():
    res = execute_query("SELECT cs.koma, cs.course_id, c.course_name FROM class_schedule cs JOIN courses c ON cs.course_id=c.course_id WHERE cs.class_id=%s AND cs.schedule_date=%s", (request.args.get('class_id'), datetime.date.today().isoformat()), fetch=True)
    return jsonify({'success': True, 'schedule': res})

@app.route(f'{API_BASE_URL}/update_schedule_date', methods=['POST'])
def update_schedule_date():
    d = request.json
    for i in d.get('updates', []):
        if not i['course_id'] or str(i['course_id'])=='0':
            execute_query("DELETE FROM class_schedule WHERE class_id=%s AND schedule_date=%s AND koma=%s", (d['class_id'], i['date'], i['koma']))
        else:
            execute_query("INSERT INTO class_schedule (class_id, schedule_date, koma, course_id) VALUES (%s,%s,%s,%s) ON DUPLICATE KEY UPDATE course_id=VALUES(course_id)", (d['class_id'], i['date'], i['koma'], i['course_id']))
    return jsonify({'success': True})

@app.route(f'{API_BASE_URL}/add_course_master', methods=['POST'])
def add_course_master():
    return jsonify({'success': execute_query("INSERT INTO courses (course_name) VALUES (%s)", (request.json.get('course_name'),)) is not None})

@app.route(f'{API_BASE_URL}/get_student_attendance_range')
def get_student_attendance_range():
    sid, s_dt, e_dt = request.args.get('student_id'), request.args.get('start_date'), request.args.get('end_date')
    q = "SELECT ar.attendance_date, ar.koma, c.course_name, ar.course_id, ar.status_id, CASE WHEN ar.status_id=1 THEN '出席' WHEN ar.status_id=2 THEN '遅刻' WHEN ar.status_id=3 THEN '欠席' WHEN ar.status_id=4 THEN '早退' ELSE '未' END AS status_text FROM attendance_records ar LEFT JOIN courses c ON ar.course_id = c.course_id WHERE ar.student_id = %s AND ar.attendance_date BETWEEN %s AND %s ORDER BY ar.attendance_date, ar.koma"
    res = execute_query(q, (sid, s_dt, e_dt), fetch=True)
    for r in res: r['attendance_date'] = r['attendance_date'].isoformat()
    return jsonify({'success': True, 'records': res})

@app.route(f'{API_BASE_URL}/get_absence_reports')
def get_absence_reports():
    dt, cls = request.args.get('date'), request.args.get('class_id')
    q = "SELECT ar.*, c.course_name, s.student_name, s.class_id, CASE WHEN ar.status_id=3 THEN '欠席' WHEN ar.status_id=2 THEN '遅刻' WHEN ar.status_id=4 THEN '早退' ELSE 'その他' END AS status_name FROM attendance_records ar JOIN students s ON ar.student_id=s.student_id LEFT JOIN courses c ON ar.course_id=c.course_id WHERE ar.reason IS NOT NULL AND ar.reason <> ''"
    p = []
    if dt: q+=" AND ar.attendance_date=%s"; p.append(dt)
    if cls and cls!='all': q+=" AND s.class_id=%s"; p.append(cls)
    res = execute_query(q+" ORDER BY ar.attendance_date DESC, s.student_id ASC, ar.koma ASC", tuple(p), fetch=True)
    for r in res: 
        r['attendance_date'] = r['attendance_date'].isoformat()
        # ★重要修正: 時間が00:00:00でも文字列化する (is not Noneを使用)
        if r.get('attendance_time') is not None: r['attendance_time'] = str(r['attendance_time'])
        if not r['course_name']: r['course_name'] = '-'
    return jsonify({'success': True, 'reports': res})

@app.route(f'{API_BASE_URL}/chat/send', methods=['POST'])
def send_chat():
    d = request.json
    sender_id, receiver_id, content = d.get('sender_id'), d.get('receiver_id'), d.get('content')
    execute_query("INSERT INTO chat_messages (sender_id, receiver_id, message_content) VALUES (%s,%s,%s)", (sender_id, receiver_id, content))

    sender_name = "不明なユーザー"
    sender_info_str = ""
    if str(sender_id).isdigit(): 
        res = execute_query("SELECT student_name, class_id FROM students WHERE student_id=%s", (sender_id,), fetch=True)
        if res: sender_name, sender_info_str = res[0]['student_name'], f"クラス{res[0]['class_id']}の {res[0]['student_name']} さん"
    else:
        res = execute_query("SELECT teacher_name FROM teachers WHERE teacher_id=%s", (sender_id,), fetch=True)
        if res: sender_name, sender_info_str = res[0]['teacher_name'], f"{res[0]['teacher_name']} 先生"

    table, col = ('students', 'student_id') if str(receiver_id).isdigit() else ('teachers', 'teacher_id')
    target = execute_query(f"SELECT email FROM {table} WHERE {col}=%s", (receiver_id,), fetch=True)
    
    if target and target[0]['email']:
        subject = f"【出席システム】新着メッセージ ({sender_name})"
        body = f"{sender_info_str} からメッセージが届きました。\n\n----------------\n{content}\n----------------\n\n出席管理システムより自動送信"
        send_email(target[0]['email'], subject, body)

    return jsonify({'success': True})

@app.route(f'{API_BASE_URL}/chat/broadcast', methods=['POST'])
def broadcast_chat():
    d = request.json
    sender_id = d.get('sender_id')
    class_ids = d.get('class_ids', []) # クラスIDのリスト
    content = d.get('content')
    
    # 教師名取得
    t_res = execute_query("SELECT teacher_name FROM teachers WHERE teacher_id=%s", (sender_id,), fetch=True)
    teacher_name = t_res[0]['teacher_name'] if t_res else "先生"

    if not class_ids:
        return jsonify({'success': False, 'message': 'クラスが選択されていません'})

    # 指定されたクラスの全生徒を取得
    # IN句のプレースホルダを作成 (例: %s, %s, %s)
    format_strings = ','.join(['%s'] * len(class_ids))
    query = f"SELECT student_id, student_name, email FROM students WHERE class_id IN ({format_strings})"
    
    students = execute_query(query, tuple(class_ids), fetch=True)
    
    count = 0
    if students:
        # クラス名を結合して件名にする (例: クラス1, 2連絡)
        class_str = ",".join(map(str, class_ids))
        subject = f"【クラス{class_str}連絡】{teacher_name} 先生より"
        body_base = f"{teacher_name} 先生からクラス全員への連絡です。\n\n----------------\n{content}\n----------------\n\n出席管理システムより自動送信"

        for s in students:
            # 1. チャット履歴に保存
            execute_query("INSERT INTO chat_messages (sender_id, receiver_id, message_content) VALUES (%s,%s,%s)", (sender_id, s['student_id'], content))
            # 2. メール送信
            if s['email']:
                body = f"{s['student_name']} さん\n\n" + body_base
                send_email(s['email'], subject, body)
            count += 1

    return jsonify({'success': True, 'count': count})

@app.route(f'{API_BASE_URL}/chat/history')
def chat_history():
    u1, u2 = request.args.get('user1'), request.args.get('user2')
    execute_query("UPDATE chat_messages SET is_read=1 WHERE sender_id=%s AND receiver_id=%s AND is_read=0", (u2, u1))
    res = execute_query("SELECT sender_id, message_content, DATE_FORMAT(timestamp, '%%Y-%%m-%%d %%H:%%i') as time FROM chat_messages WHERE (sender_id=%s AND receiver_id=%s) OR (sender_id=%s AND receiver_id=%s) ORDER BY timestamp ASC", (u1,u2,u2,u1), fetch=True)
    return jsonify({'success': True, 'messages': res})

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=443, debug=True, ssl_context='adhoc')