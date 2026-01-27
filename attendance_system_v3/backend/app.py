#-*- coding:utf-8 -*-
from flask import Flask, request, jsonify, redirect, Response
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
# ▼ フォルダ位置の設定
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
# ▼ Basic認証の設定
# ==========================================
app.config['BASIC_AUTH_USERNAME'] = 'admin'
app.config['BASIC_AUTH_PASSWORD'] = 'sotsuken2026'
app.config['BASIC_AUTH_FORCE'] = True
basic_auth = BasicAuth(app)

# ==========================================
# ▼ 定数・設定
# ==========================================
STATUS_NAMES = {
    1: "出席",
    2: "遅刻",
    3: "欠席",
    4: "早退"
}

# 授業開始時間定義
PERIOD_START_TIMES = { 
    1: "09:10", 
    2: "11:00", 
    3: "13:30", 
    4: "15:15" 
}

# ==========================================
# ▼ ヘルパー関数
# ==========================================
@app.route('/')
def index():
    return redirect('/html/index.html')

# メール送信
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
    except Exception as e:
        print(f"Mail Error: {e}")

# 距離計算 (Haversine formula)
def calc_geo_distance(lat1, lon1, lat2, lon2):
    R = 6371000
    phi1 = math.radians(lat1)
    phi2 = math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlam = math.radians(lon2 - lon1)
    
    a = math.sin(dphi/2)**2 + math.cos(phi1)*math.cos(phi2)*math.sin(dlam/2)**2
    return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1-a))

# 顔特徴量の距離計算
def calc_face_distance(vec1, vec2):
    return np.linalg.norm(np.array(vec1) - np.array(vec2))

# ★修正: 出席率計算ロジック (遅刻・早退は2/3点)
def calculate_attendance_rate(student_id):
    s_info = execute_query("SELECT class_id, student_name, email FROM students WHERE student_id=%s", (student_id,), fetch=True)
    if not s_info or not s_info[0]['class_id']:
        return 0, 0, {}, None

    class_id = s_info[0]['class_id']
    today = datetime.date.today().isoformat()

    # 分母：今日までに実施された授業総数
    sch_res = execute_query("SELECT COUNT(*) as total FROM class_schedule WHERE class_id=%s AND schedule_date <= %s", (class_id, today), fetch=True)
    total_classes = sch_res[0]['total'] if sch_res else 0

    # 分子：各ステータスの回数
    stats_res = execute_query("""
        SELECT status_id, COUNT(*) as cnt 
        FROM attendance_records 
        WHERE student_id=%s AND attendance_date <= %s 
        GROUP BY status_id
    """, (student_id, today), fetch=True)
    
    counts = {1:0, 2:0, 3:0, 4:0}
    for r in stats_res:
        counts[r['status_id']] = r['cnt']

    # 点数計算: 出席(1)=1点, 遅刻(2)/早退(4)=2/3点, 欠席(3)=0点
    attended_points = (counts[1] * 1.0) + ((counts[2] + counts[4]) * (2/3))
    
    rate = 0.0
    if total_classes > 0:
        rate = round((attended_points / total_classes) * 100, 1)
        
    return rate, total_classes, counts, s_info[0]

# 管理者権限チェック関数
def is_admin_request(req_data):
    rid = req_data.get('requester_id')
    if not rid: return False
    res = execute_query("SELECT is_admin FROM teachers WHERE teacher_id=%s", (rid,), fetch=True)
    return True if res and res[0].get('is_admin') == 1 else False

# ==========================================
# ▼ API ルート定義
# ==========================================

@app.route(f'{API_BASE_URL}/login', methods=['POST'])
def login():
    try:
        d = request.json
        u = str(d.get('id')).strip()
        p = str(d.get('password')).strip()
        
        # 教員ログイン (管理者フラグも取得)
        teacher = execute_query("SELECT teacher_id, is_admin FROM teachers WHERE teacher_id=%s AND password=%s", (u, p), fetch=True)
        if teacher:
            unread = execute_query("SELECT COUNT(*) as c FROM chat_messages WHERE receiver_id=%s AND is_read=0", (u,), fetch=True)[0]['c']
            # 管理者なら role='admin'
            role = 'admin' if teacher[0].get('is_admin') == 1 else 'teacher'
            return jsonify({'success': True, 'role': role, 'user_id': u, 'unread_count': unread})

        # 生徒ログイン
        student = execute_query("SELECT s.student_id, s.class_id, sa.face_encoding FROM students s JOIN student_auth sa ON s.student_id=sa.student_id WHERE s.student_id=%s AND sa.password=%s", (u, p), fetch=True)
        if student:
            unread = execute_query("SELECT COUNT(*) as c FROM chat_messages WHERE receiver_id=%s AND is_read=0", (u,), fetch=True)[0]['c']
            return jsonify({'success': True, 'role': 'student', 'user_id': u, 'class_id': student[0]['class_id'], 'unread_count': unread, 'needs_setup': not student[0]['face_encoding']})

        return jsonify({'success': False, 'message': 'IDまたはパスワードが間違っています'}), 401
    except Exception as e:
        traceback.print_exc()
        return jsonify({'success': False, 'message': 'サーバーエラー'}), 500

@app.route(f'{API_BASE_URL}/first_setup', methods=['POST'])
def first_setup():
    try:
        d = request.json
        sid, new_pass, desc = d.get('student_id'), d.get('new_password'), d.get('descriptor')
        if not sid or not new_pass or not desc: return jsonify({'success': False, 'message': 'データ不足'}), 400
        execute_query("UPDATE student_auth SET password=%s, face_encoding=%s WHERE student_id=%s", (new_pass, json.dumps(desc), sid))
        return jsonify({'success': True})
    except Exception as e:
        return jsonify({'success': False, 'message': str(e)}), 500

@app.route(f'{API_BASE_URL}/get_student_info')
def get_student_info():
    res = execute_query("SELECT student_name, class_id FROM students WHERE student_id=%s", (request.args.get('student_id'),), fetch=True)
    return jsonify({'success': True, 'student': res[0]}) if res else jsonify({'success': False})

@app.route(f'{API_BASE_URL}/get_course_koma')
def get_course_koma():
    c = execute_query("SELECT * FROM courses", fetch=True)
    komas = [{'koma_id': i, 'koma_name': f'{i}限'} for i in range(1,5)]
    return jsonify({'success': True, 'courses': c, 'komas': komas})

# --- 顔登録関連 ---
@app.route(f'{API_BASE_URL}/register_face', methods=['POST'])
def register_face():
    try:
        d = request.json
        sid, desc = d.get('student_id'), d.get('descriptor')
        if not sid or not desc: return jsonify({'success': False}), 400
        
        auth = execute_query("SELECT registration_expiry FROM student_auth WHERE student_id=%s", (sid,), fetch=True)
        if not auth: return jsonify({'success': False, 'message': '生徒不明'}), 400
        
        expiry = auth[0].get('registration_expiry')
        if not expiry or expiry < datetime.datetime.now():
             return jsonify({'success': False, 'message': '登録の許可期限が切れています。先生に許可をもらってください。'}), 403

        execute_query("UPDATE student_auth SET face_encoding=%s WHERE student_id=%s", (json.dumps(desc), sid))
        return jsonify({'success': True})
    except Exception as e:
        return jsonify({'success': False, 'message': str(e)}), 500

@app.route(f'{API_BASE_URL}/allow_face_registration', methods=['POST'])
def allow_face_registration():
    try:
        d = request.json
        sid = d.get('student_id')
        expiry = datetime.datetime.now() + timedelta(minutes=5)
        execute_query("UPDATE student_auth SET registration_expiry=%s WHERE student_id=%s", (expiry, sid))
        return jsonify({'success': True, 'expiry': expiry.strftime('%H:%M:%S')})
    except Exception as e:
        return jsonify({'success': False, 'message': str(e)}), 500

@app.route(f'{API_BASE_URL}/reset_student_password', methods=['POST'])
def reset_student_password():
    try:
        d = request.json
        sid, new_pass = d.get('student_id'), d.get('new_password')
        if not sid or not new_pass: return jsonify({'success': False}), 400
        execute_query("UPDATE student_auth SET password=%s WHERE student_id=%s", (new_pass, sid))
        return jsonify({'success': True})
    except Exception as e:
        return jsonify({'success': False, 'message': str(e)}), 500

# --- 出席打刻関連 ---
# 位置情報の事前チェックAPI
@app.route(f'{API_BASE_URL}/validate_location', methods=['POST'])
def validate_location():
    try:
        d = request.json
        lat, lng = d.get('lat'), d.get('lng')
        if lat is None or lng is None: return jsonify({'success': False, 'message': '位置情報不足'}), 400
        
        dist = calc_geo_distance(float(lat), float(lng), SCHOOL_LOCATION['lat'], SCHOOL_LOCATION['lng'])
        if dist > ALLOWED_RADIUS_METERS:
            return jsonify({'success': False, 'message': f'学校の範囲外です (距離: {int(dist)}m)', 'in_range': False})
        
        return jsonify({'success': True, 'in_range': True, 'message': '範囲内です'})
    except Exception as e:
        return jsonify({'success': False, 'message': str(e)}), 500

@app.route(f'{API_BASE_URL}/check_in', methods=['POST'])
def check_in():
    try:
        d = request.json
        sid, desc, cid, koma, lat, lng = d.get('student_id'), d.get('descriptor'), d.get('course_id'), d.get('koma'), d.get('lat'), d.get('lng')

        if not sid or not desc: return jsonify({'success': False, 'message': 'データ不足'}), 400
        if not cid or not koma: return jsonify({'success': False, 'message': '授業選択不足'}), 400
        if lat is None: return jsonify({'success': False, 'message': '位置情報不足'}), 400

        try: koma, lat, lng = int(koma), float(lat), float(lng)
        except: return jsonify({'success': False, 'message': 'データ形式エラー'}), 400

        if calc_geo_distance(lat, lng, SCHOOL_LOCATION['lat'], SCHOOL_LOCATION['lng']) > ALLOWED_RADIUS_METERS:
            return jsonify({'success': False, 'message': '学校の範囲外です'}), 400

        auth = execute_query("SELECT face_encoding FROM student_auth WHERE student_id=%s", (sid,), fetch=True)
        if not auth or not auth[0]['face_encoding']: return jsonify({'success': False, 'message': '顔未登録'}), 400
        
        if calc_face_distance(desc, json.loads(auth[0]['face_encoding'])) > FACE_MATCH_THRESHOLD:
            return jsonify({'success': False, 'message': '顔不一致'}), 401

        now = datetime.datetime.now()
        today = datetime.date.today().isoformat()
        start_str = PERIOD_START_TIMES.get(koma, "00:00")
        start_dt = datetime.datetime.combine(datetime.date.today(), datetime.datetime.strptime(start_str, "%H:%M").time())
        
        if now < start_dt - timedelta(minutes=5):
            wait = int((start_dt - timedelta(minutes=5) - now).total_seconds()/60)+1
            return jsonify({'success': False, 'message': f'開始5分前までお待ちください'}), 400

        st_id = 1
        if now > start_dt + timedelta(minutes=30): st_id = 3
        elif now > start_dt + timedelta(minutes=3): st_id = 2
        
        exist = execute_query("SELECT * FROM attendance_records WHERE student_id=%s AND attendance_date=%s AND koma=%s", (sid, today, koma), fetch=True)
        if exist: return jsonify({'success': False, 'message': '登録済みです'}), 400
        
        execute_query("INSERT INTO attendance_records (student_id, attendance_date, course_id, koma, status_id, attendance_time) VALUES (%s,%s,%s,%s,%s,%s)", (sid, today, cid, koma, st_id, now.strftime('%H:%M:%S')))
        
        try:
            rate, _, _, s_info = calculate_attendance_rate(sid)
            if rate < 80.0 and s_info and s_info['email']:
                send_email(s_info['email'], "【警告】出席率低下", f"{s_info['student_name']} さん\n出席率が{rate}%です。\n80%を下回りました。")
        except: pass

        return jsonify({'success': True, 'message': '完了しました'})
    except Exception as e:
        traceback.print_exc()
        return jsonify({'success': False, 'message': f'エラー: {str(e)}'}), 500

@app.route(f'{API_BASE_URL}/report_absence', methods=['POST'])
def report_absence():
    d = request.json
    sid, date, reports, reason = d.get('student_id'), d.get('absence_date'), d.get('reports', []), d.get('reason')
    if not sid or not date or not reports: return jsonify({'success': False, 'message': 'データ不足'}), 400

    s_info = execute_query("SELECT student_name, class_id FROM students WHERE student_id=%s", (sid,), fetch=True)
    if not s_info: return jsonify({'success': False}), 400
    
    count, skipped = 0, 0
    mail_details = []
    for item in reports:
        k, st_id = item['koma'], item['status']
        if execute_query("SELECT record_id FROM attendance_records WHERE student_id=%s AND attendance_date=%s AND koma=%s", (sid, date, k), fetch=True):
            skipped += 1; continue
        c_name = "(授業なし)"
        sch = execute_query("SELECT c.course_name, c.course_id FROM class_schedule cs JOIN courses c ON cs.course_id=c.course_id WHERE cs.class_id=%s AND cs.schedule_date=%s AND cs.koma=%s", (s_info[0]['class_id'], date, k), fetch=True)
        cid = sch[0]['course_id'] if sch else None
        if sch: c_name = sch[0]['course_name']
        execute_query("INSERT INTO attendance_records (student_id, attendance_date, course_id, koma, status_id, reason) VALUES (%s,%s,%s,%s,%s,%s)", (sid, date, cid, k, st_id, reason))
        mail_details.append(f"・{k}限 ({c_name}): {STATUS_NAMES.get(st_id)}")
        count += 1

    if count > 0:
        ts = execute_query("SELECT t.email, t.teacher_name FROM teachers t JOIN teacher_assignments ta ON t.teacher_id=ta.teacher_id WHERE ta.class_id=%s", (s_info[0]['class_id'],), fetch=True)
        for t in ts:
            if t['email']: send_email(t['email'], f"【欠席連絡】{s_info[0]['student_name']}", f"{t['teacher_name']} 先生\n\n{s_info[0]['student_name']}から連絡:\n{date}\n" + "\n".join(mail_details) + f"\n理由: {reason}")

    return jsonify({'success': True, 'count': count, 'message': f'{count}件登録しました'})

# --- 情報取得・管理 ---
@app.route(f'{API_BASE_URL}/student_records')
def student_records():
    res = execute_query("SELECT ar.attendance_date, ar.koma, c.course_name, ar.attendance_time, sc.status_name as attendance_status FROM attendance_records ar LEFT JOIN courses c ON ar.course_id=c.course_id JOIN status_codes sc ON ar.status_id=sc.status_id WHERE ar.student_id=%s ORDER BY ar.attendance_date DESC, ar.koma DESC", (request.args.get('student_id'),), fetch=True)
    for r in res:
        r['attendance_date'] = r['attendance_date'].isoformat() if r['attendance_date'] else ''
        r['attendance_time'] = str(r['attendance_time']) if r['attendance_time'] else ''
        if not r['course_name']: r['course_name'] = '-'
    return jsonify({'success': True, 'records': res or []})

@app.route(f'{API_BASE_URL}/get_student_stats')
def get_student_stats():
    rate, total, counts, _ = calculate_attendance_rate(request.args.get('student_id'))
    return jsonify({'success': True, 'rate': rate, 'counts': counts, 'total_classes': total})

@app.route(f'{API_BASE_URL}/download_attendance_csv')
def download_attendance_csv():
    cid, y, m = request.args.get('class_id'), request.args.get('year'), request.args.get('month')
    if not cid or cid=='all': return "クラス選択必須", 400
    res = execute_query("SELECT s.student_id, s.student_name, ar.attendance_date, ar.koma, sc.status_name FROM students s LEFT JOIN attendance_records ar ON s.student_id=ar.student_id AND MONTH(ar.attendance_date)=%s AND YEAR(ar.attendance_date)=%s LEFT JOIN status_codes sc ON ar.status_id=sc.status_id WHERE s.class_id=%s ORDER BY s.student_id, ar.attendance_date, ar.koma", (m, y, cid), fetch=True)
    csv = "学籍番号,氏名,日付,時限,ステータス\n"
    for r in res: csv += f"{r['student_id']},{r['student_name']},{r['attendance_date'] or ''},{r['koma'] or ''},{r['status_name'] or '未登録'}\n"
    return Response("\ufeff"+csv, mimetype="text/csv", headers={"Content-disposition": f"attachment; filename=attendance_{cid}_{y}_{m}.csv"})

@app.route(f'{API_BASE_URL}/realtime_status')
def realtime_status():
    k, dt, cls = request.args.get('koma'), request.args.get('date'), request.args.get('class_id')
    q = "SELECT s.student_id, s.student_name, s.class_id, ar.attendance_time as time, sc.status_name as attendance_status, COALESCE(c_act.course_name, c_sch.course_name) as course_name, COALESCE(ar.course_id, cs.course_id) as course_id FROM students s LEFT JOIN attendance_records ar ON s.student_id=ar.student_id AND ar.attendance_date=%s AND ar.koma=%s LEFT JOIN courses c_act ON ar.course_id=c_act.course_id LEFT JOIN status_codes sc ON ar.status_id=sc.status_id LEFT JOIN class_schedule cs ON s.class_id=cs.class_id AND cs.schedule_date=%s AND cs.koma=%s LEFT JOIN courses c_sch ON cs.course_id=c_sch.course_id"
    p = [dt, k, dt, k]
    if cls and cls!='all': q+=" WHERE s.class_id=%s"; p.append(cls)
    res = execute_query(q+" ORDER BY s.student_id", tuple(p), fetch=True)
    for r in res:
        r['time'] = str(r['time']) if r['time'] else '-'
        r['attendance_status'] = r['attendance_status'] or '未出席'
        r['course_name'] = r['course_name'] or '-'
    return jsonify({'success': True, 'records': res})

@app.route(f'{API_BASE_URL}/update_attendance_status', methods=['POST'])
def update_attendance_status():
    d = request.json
    sid, dt, k, st, cid = d['student_id'], d['date'], d['koma'], d['status_id'], d['course_id']
    if execute_query("SELECT record_id FROM attendance_records WHERE student_id=%s AND attendance_date=%s AND koma=%s", (sid, dt, k), fetch=True):
        execute_query("UPDATE attendance_records SET status_id=%s, course_id=%s WHERE student_id=%s AND attendance_date=%s AND koma=%s", (st, cid, sid, dt, k))
    else:
        execute_query("INSERT INTO attendance_records (student_id, attendance_date, course_id, koma, status_id, attendance_time) VALUES (%s,%s,%s,%s,%s,%s)", (sid, dt, cid, k, st, datetime.datetime.now().strftime('%H:%M:%S')))
    return jsonify({'success': True})

@app.route(f'{API_BASE_URL}/delete_attendance_record', methods=['POST'])
def delete_attendance_record():
    d = request.json
    execute_query("DELETE FROM attendance_records WHERE student_id=%s AND attendance_date=%s AND koma=%s", (d['student_id'], d['date'], d['koma']))
    return jsonify({'success': True})

@app.route(f'{API_BASE_URL}/get_student_list')
def get_student_list():
    cls = request.args.get('class_id')
    q = "SELECT s.* FROM students s"
    p = ()
    if cls and cls!='all': q+=" WHERE s.class_id=%s"; p=(cls,)
    res = execute_query(q, p, fetch=True)
    for r in res: r['birthday'] = r['birthday'].isoformat() if r['birthday'] else ''
    return jsonify({'success': True, 'students': res})

# CRUD系
@app.route(f'{API_BASE_URL}/add_student', methods=['POST'])
def add_student():
    d = request.json
    if execute_query("INSERT INTO students (student_id, student_name, class_id, gender, birthday, email) VALUES (%s,%s,%s,%s,%s,%s)", (d['student_id'], d['student_name'], d.get('class_id'), d.get('gender'), d.get('birthday'), d.get('email'))):
        execute_query("INSERT INTO student_auth (student_id, password) VALUES (%s,%s)", (d['student_id'], d['password']))
        return jsonify({'success': True})
    return jsonify({'success': False})

@app.route(f'{API_BASE_URL}/update_student', methods=['POST'])
def update_student():
    d = request.json
    execute_query("UPDATE students SET student_name=%s, class_id=%s, gender=%s, birthday=%s, email=%s WHERE student_id=%s", (d['student_name'], d['class_id'], d['gender'], d['birthday'], d.get('email'), d['student_id']))
    if d.get('password'):
        execute_query("UPDATE student_auth SET password=%s WHERE student_id=%s", (d['password'], d['student_id']))
    return jsonify({'success': True})

@app.route(f'{API_BASE_URL}/delete_student', methods=['POST'])
def delete_student():
    execute_query("DELETE FROM students WHERE student_id=%s", (request.json['student_id'],))
    return jsonify({'success': True})

@app.route(f'{API_BASE_URL}/get_teacher_list')
def get_teacher_list():
    res = execute_query("SELECT t.*, GROUP_CONCAT(ta.class_id) as assigned_classes FROM teachers t LEFT JOIN teacher_assignments ta ON t.teacher_id=ta.teacher_id GROUP BY t.teacher_id", fetch=True)
    for r in res: r['assigned_classes'] = [int(x) for x in str(r['assigned_classes']).split(',')] if r['assigned_classes'] else []
    return jsonify({'success': True, 'teachers': res})

@app.route(f'{API_BASE_URL}/add_teacher', methods=['POST'])
def add_teacher():
    d = request.json
    if not is_admin_request(d): return jsonify({'success': False, 'message': '権限なし'}), 403
    if execute_query("INSERT INTO teachers (teacher_id, password, teacher_name, email) VALUES (%s,%s,%s,%s)", (d['teacher_id'], d['password'], d['teacher_name'], d['email'])):
        for c in d.get('assigned_classes', []): execute_query("INSERT INTO teacher_assignments (teacher_id, class_id) VALUES (%s,%s)", (d['teacher_id'], c))
        return jsonify({'success': True})
    return jsonify({'success': False})

@app.route(f'{API_BASE_URL}/update_teacher', methods=['POST'])
def update_teacher():
    d = request.json
    if not is_admin_request(d): return jsonify({'success': False, 'message': '権限なし'}), 403
    execute_query("UPDATE teachers SET teacher_name=%s, email=%s WHERE teacher_id=%s", (d['teacher_name'], d['email'], d['teacher_id']))
    if d.get('password'): execute_query("UPDATE teachers SET password=%s WHERE teacher_id=%s", (d['password'], d['teacher_id']))
    execute_query("DELETE FROM teacher_assignments WHERE teacher_id=%s", (d['teacher_id'],))
    for c in d.get('assigned_classes', []): execute_query("INSERT INTO teacher_assignments (teacher_id, class_id) VALUES (%s,%s)", (d['teacher_id'], c))
    return jsonify({'success': True})

@app.route(f'{API_BASE_URL}/delete_teacher', methods=['POST'])
def delete_teacher():
    d = request.json
    if not is_admin_request(d): return jsonify({'success': False, 'message': '権限なし'}), 403
    return jsonify({'success': execute_query("DELETE FROM teachers WHERE teacher_id=%s", (d['teacher_id'],)) is not None})

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
    for i in request.json['updates']:
        if not i['course_id'] or str(i['course_id'])=='0': execute_query("DELETE FROM class_schedule WHERE class_id=%s AND schedule_date=%s AND koma=%s", (request.json['class_id'], i['date'], i['koma']))
        else: execute_query("INSERT INTO class_schedule (class_id, schedule_date, koma, course_id) VALUES (%s,%s,%s,%s) ON DUPLICATE KEY UPDATE course_id=VALUES(course_id)", (request.json['class_id'], i['date'], i['koma'], i['course_id']))
    return jsonify({'success': True})

@app.route(f'{API_BASE_URL}/add_course_master', methods=['POST'])
def add_course_master():
    return jsonify({'success': execute_query("INSERT INTO courses (course_name) VALUES (%s)", (request.json['course_name'],)) is not None})

@app.route(f'{API_BASE_URL}/get_student_attendance_range')
def get_student_attendance_range():
    sid, s, e = request.args.get('student_id'), request.args.get('start_date'), request.args.get('end_date')
    res = execute_query("SELECT ar.attendance_date, ar.koma, c.course_name, ar.course_id, ar.status_id, CASE WHEN ar.status_id=1 THEN '出席' WHEN ar.status_id=2 THEN '遅刻' WHEN ar.status_id=3 THEN '欠席' WHEN ar.status_id=4 THEN '早退' ELSE '未' END AS status_text FROM attendance_records ar LEFT JOIN courses c ON ar.course_id=c.course_id WHERE ar.student_id=%s AND ar.attendance_date BETWEEN %s AND %s ORDER BY ar.attendance_date, ar.koma", (sid, s, e), fetch=True)
    for r in res: r['attendance_date'] = r['attendance_date'].isoformat()
    return jsonify({'success': True, 'records': res or []})

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
        r['attendance_time'] = str(r['attendance_time']) if r['attendance_time'] else ''
        r['course_name'] = r['course_name'] or '-'
    return jsonify({'success': True, 'reports': res})

@app.route(f'{API_BASE_URL}/chat/send', methods=['POST'])
def send_chat():
    d = request.json
    execute_query("INSERT INTO chat_messages (sender_id, receiver_id, message_content) VALUES (%s,%s,%s)", (d['sender_id'], d['receiver_id'], d['content']))
    return jsonify({'success': True})

@app.route(f'{API_BASE_URL}/chat/broadcast', methods=['POST'])
def broadcast_chat():
    d = request.json
    ids = d.get('class_ids', [])
    if not ids: return jsonify({'success': False})
    s_list = execute_query(f"SELECT student_id, email, student_name FROM students WHERE class_id IN ({','.join(['%s']*len(ids))})", tuple(ids), fetch=True)
    t_name = execute_query("SELECT teacher_name FROM teachers WHERE teacher_id=%s", (d['sender_id'],), fetch=True)[0]['teacher_name']
    count = 0
    for s in s_list:
        execute_query("INSERT INTO chat_messages (sender_id, receiver_id, message_content) VALUES (%s,%s,%s)", (d['sender_id'], s['student_id'], d['content']))
        if s['email']: send_email(s['email'], f"【クラス連絡】{t_name}先生", f"{s['student_name']}さん\n\n{d['content']}")
        count+=1
    return jsonify({'success': True, 'count': count})

@app.route(f'{API_BASE_URL}/chat/history')
def chat_history():
    u1, u2 = request.args.get('user1'), request.args.get('user2')
    execute_query("UPDATE chat_messages SET is_read=1 WHERE sender_id=%s AND receiver_id=%s AND is_read=0", (u2, u1))
    res = execute_query("SELECT sender_id, message_content, DATE_FORMAT(timestamp, '%%Y-%%m-%%d %%H:%%i') as time FROM chat_messages WHERE (sender_id=%s AND receiver_id=%s) OR (sender_id=%s AND receiver_id=%s) ORDER BY timestamp ASC", (u1,u2,u2,u1), fetch=True)
    return jsonify({'success': True, 'messages': res})

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=443, debug=True, ssl_context='adhoc')