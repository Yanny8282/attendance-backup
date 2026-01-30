#-*- coding:utf-8 -*-

# DB接続設定
DB_CONFIG = {
    'user': 'admin',
    'password': 'password',  # ★MySQLのパスワード
    'host': 'attendance-db.cxa46ccmmfne.ap-northeast-1.rds.amazonaws.com',
    'database': 'attendance_system_v2_db',
    'charset': 'utf8mb4'
}

# サーバー設定
API_BASE_URL = '/api'
SCHOOL_LOCATION = {
    'lat': 37.9158528,
    'lng': 139.0608384
}
ALLOWED_RADIUS_METERS = 3000

# メール設定 (Gmail SSL/465)
EMAIL_CONFIG = {
    'smtp_server': 'smtp.gmail.com',
    'smtp_port': 465,
    'sender_email': 'sotsuken.reply@gmail.com', # ★送信元Gmail
    'password': 'zsck gfdq tzrr qsgm'       # ★アプリパスワード(16桁)
}

# 顔認証の閾値 (0.0〜1.0)
# クライアント側(face-api)のDescriptor間のユークリッド距離
# 0.6が一般的ですが、誤検知を防ぐため少し厳しめに設定
FACE_MATCH_THRESHOLD = 0.3