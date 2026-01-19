// ★修正箇所: HTTPS化に伴い、相対パスに変更
const API_BASE_URL = '/api';

document.addEventListener('DOMContentLoaded', () => {
    const loginBtn = document.getElementById('loginButton');
    const idInput = document.getElementById('id');
    const passInput = document.getElementById('password');

    // ★Enterキー対応
    const triggerLogin = (e) => {
        if (e.key === 'Enter') loginBtn.click();
    };
    idInput.addEventListener('keypress', triggerLogin);
    passInput.addEventListener('keypress', triggerLogin);

    loginBtn.addEventListener('click', async () => {
        const u = idInput.value.trim();
        const p = passInput.value.trim();
        const msg = document.getElementById('message');
        msg.textContent = '';

        if(!u || !p) { msg.textContent='IDとパスワードを入力してください'; return; }

        try {
            const res = await fetch(`${API_BASE_URL}/login`, {
                method: 'POST', headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({id: u, password: p})
            });
            const ret = await res.json();

            if(ret.success) {
                sessionStorage.setItem('user_id', ret.user_id);
                sessionStorage.setItem('user_role', ret.role);
                if(ret.unread_count > 0) sessionStorage.setItem('unread_count', ret.unread_count);
                
                msg.style.color = 'green';
                msg.textContent = 'ログイン成功。移動します...';
                setTimeout(() => {
                    location.href = ret.role === 'student' ? '../html/student.html' : '../html/teacher.html';
                }, 500);
            } else {
                msg.style.color = 'red';
                msg.textContent = ret.message;
            }
        } catch(e) {
            console.error(e);
            msg.style.color = 'red';
            msg.textContent = 'サーバー通信エラー';
        }
    });
});