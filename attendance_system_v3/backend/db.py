import mysql.connector
from config import DB_CONFIG

def get_connection():
    return mysql.connector.connect(**DB_CONFIG)

def execute_query(query, params=(), fetch=False):
    conn = None
    cursor = None
    try:
        conn = get_connection()
        cursor = conn.cursor(dictionary=True)
        cursor.execute(query, params)
        if fetch:
            result = cursor.fetchall()
            return result
        conn.commit()
        return True
    except Exception as e:
        print(f"DB Error: {e}")
        return None
    finally:
        if cursor: cursor.close()
        if conn: conn.close()