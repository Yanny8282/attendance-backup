const API_BASE_URL = '/api';
let detectedDescriptor = null;

// ログインチェック
const sid = sessionStorage.getItem('user_id');
if (!sid || sessionStorage.getItem('user_role') !== 'student') {
    location.replace('../html/index.html');
}

document.addEventListener('DOMContentLoaded', async () => {
    const video = document.getElementById('videoSetup');
    const status = document.getElementById('faceStatus');
    const btn = document.getElementById('completeSetupBtn');
    
    // AIモデル読み込み
    try {
        status.textContent = "AIモデルを読み込み中...";
        await faceapi.nets.ssdMobilenetv1.loadFromUri('../models');
        await faceapi.nets.faceLandmark68Net.loadFromUri('../models');
        await faceapi.nets.faceRecognitionNet.loadFromUri('../models');
        status.textContent = "カメラを起動中...";
        
        // カメラ起動
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' } });
        video.srcObject = stream;
        status.textContent = "顔をカメラに向けてください";
        status.style.color = "#007bff";

        // 顔検出ループ
        setInterval(async () => {
            if (video.paused || video.ended || !faceapi.nets.ssdMobilenetv1.params) return;
            
            const detection = await faceapi.detectSingleFace(video).withFaceLandmarks().withFaceDescriptor();
            
            if (detection) {
                detectedDescriptor = Array.from(detection.descriptor);
                status.textContent = "✅ 顔を認識しました";
                status.style.color = "green";
                checkForm();
            } else {
                detectedDescriptor = null;
                status.textContent = "🔍 顔を探しています...";
                status.style.color = "orange";
                btn.disabled = true;
            }
        }, 1000);

    } catch(e) {
        console.error(e);
        status.textContent = "エラー: カメラまたはAIの起動に失敗しました";
        alert("カメラの使用を許可してください。");
    }

    // 入力チェックと送信
    const p1 = document.getElementById('newPassword');
    const p2 = document.getElementById('confirmPassword');

    const checkForm = () => {
        if (detectedDescriptor && p1.value.length >= 4 && p1.value === p2.value) {
            btn.disabled = false;
        } else {
            btn.disabled = true;
        }
    };

    p1.addEventListener('input', checkForm);
    p2.addEventListener('input', checkForm);

    btn.onclick = async () => {
        if(!detectedDescriptor) return;
        
        btn.disabled = true;
        btn.textContent = "設定中...";

        try {
            const res = await fetch(`${API_BASE_URL}/first_setup`, {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({
                    student_id: sid,
                    new_password: p1.value,
                    descriptor: detectedDescriptor
                })
            });
            const d = await res.json();
            if (d.success) {
                alert("設定が完了しました！ログインします。");
                location.replace('../html/student.html');
            } else {
                alert("エラー: " + d.message);
                btn.disabled = false;
                btn.textContent = "設定を完了して開始";
            }
        } catch(e) {
            console.error(e);
            alert("通信エラーが発生しました");
            btn.disabled = false;
        }
    };
});