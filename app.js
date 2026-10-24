/**
 * FocusFlow Pomodoro Timer Application Logic
 * - 25m Focus / 5m Break Auto-switch
 * - SVG Circular Progress Ring
 * - Live Browser Tab Title Sync
 * - Web Audio API Ambient Sound Generator (Waves, Rain, Birds) + Chime Alarm
 * - Session Counter with LocalStorage Persistence
 * - Smooth Mode/Theme Transitions
 */

(() => {
  'use strict';

  // 1. 설정 및 상수
  const FOCUS_TIME = 25 * 60; // 25분 (초)
  const BREAK_TIME = 5 * 60;  // 5분 (초)
  const CIRCLE_RADIUS = 145;
  const CIRCLE_CIRCUMFERENCE = 2 * Math.PI * CIRCLE_RADIUS; // 약 911.06

  // 2. DOM 요소 셀렉터
  const body = document.body;
  const timeDisplay = document.getElementById('timeDisplay');
  const timeSubtext = document.getElementById('timeSubtext');
  const modePill = document.getElementById('modePill');
  const modeText = document.getElementById('modeText');
  const progressRing = document.getElementById('progressRing');
  
  const startPauseBtn = document.getElementById('startPauseBtn');
  const startPauseText = document.getElementById('startPauseText');
  const playIcon = document.getElementById('playIcon');
  const pauseIcon = document.getElementById('pauseIcon');
  const resetBtn = document.getElementById('resetBtn');
  const skipBtn = document.getElementById('skipBtn');
  
  const sessionCountEl = document.getElementById('sessionCount');
  const resetSessionBtn = document.getElementById('resetSessionBtn');

  const soundChips = document.querySelectorAll('.sound-chip');
  const audioEqualizer = document.getElementById('audioEqualizer');
  const volumeSlider = document.getElementById('volumeSlider');
  const volumeTrackFill = document.getElementById('volumeTrackFill');
  const volumeLevelText = document.getElementById('volumeLevelText');
  const muteBtn = document.getElementById('muteBtn');
  const volumeIcon = document.getElementById('volumeIcon');
  const muteIcon = document.getElementById('muteIcon');

  // 3. 앱 상태 (State)
  let currentMode = 'focus'; // 'focus' | 'break'
  let timeLeft = FOCUS_TIME;
  let timerInterval = null;
  let isRunning = false;
  let completedSessions = 0;

  // 오디오 상태 및 로컬 고음질 MP3 음원 (모든 브라우저/Safari 100% 호환)
  const SOUND_SOURCES = {
    wave: 'sounds/waves.mp3',
    rain: 'sounds/rain_steady.mp3',
    snow: 'sounds/snow.mp3'
  };

  let currentSound = 'none'; // 'none' | 'wave' | 'rain' | 'snow'
  let currentVolume = 0.6; // 0.0 ~ 1.0
  let isMuted = false;
  let currentAudio = null; // HTML5 Audio 엘리먼트 (로컬 MP3 오디오)

  // 4. Web Audio API 엔진 (알람음 및 오프라인 백색소음 신시사이저)
  let audioCtx = null;
  let ambientGainNode = null;
  let activeSoundNodes = []; // 정지 시 정리할 노드들
  let soundInterval = null;

  function initAudioContext() {
    if (!audioCtx) {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      audioCtx = new AudioContext();
      ambientGainNode = audioCtx.createGain();
      ambientGainNode.gain.setValueAtTime(isMuted ? 0 : currentVolume, audioCtx.currentTime);
      ambientGainNode.connect(audioCtx.destination);
    }
    if (audioCtx.state === 'suspended') {
      audioCtx.resume();
    }
  }

  // 5. 알림음 (Chime / Alarm) - 고음질 알람 MP3 + Web Audio 벨 차임 듀얼 재생
  function playAlarmChime() {
    // 1) 고음질 알람 MP3 재생
    try {
      const alarmAudio = new Audio('sounds/alarm.mp3');
      alarmAudio.volume = isMuted ? 0.6 : Math.max(0.8, currentVolume);
      alarmAudio.play().catch(e => console.log('MP3 alarm fallback:', e));
    } catch (e) {
      // 무시
    }

    // 2) Web Audio API 기반 맑은 마림바/벨 아르페지오 (C5 - E5 - G5 - C6)
    initAudioContext();
    if (!audioCtx) return;

    const notes = [523.25, 659.25, 783.99, 1046.50]; // C5, E5, G5, C6
    const startTime = audioCtx.currentTime + 0.05;

    notes.forEach((freq, index) => {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, startTime + index * 0.14);

      // 하모닉 배음 추가 (벨 느낌의 맑은 여운)
      gain.gain.setValueAtTime(0, startTime + index * 0.14);
      gain.gain.linearRampToValueAtTime(0.4, startTime + index * 0.14 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, startTime + index * 0.14 + 1.2);

      osc.connect(gain);
      gain.connect(audioCtx.destination);

      osc.start(startTime + index * 0.14);
      osc.stop(startTime + index * 0.14 + 1.3);
    });
  }

  // 6. 백색소음 제어 시스템 (고품질 자연 음원 + Web Audio 폴백)
  function stopAmbientSound() {
    // 1) HTML5 Audio 정지
    if (currentAudio) {
      currentAudio.pause();
      currentAudio.currentTime = 0;
      currentAudio.src = '';
      currentAudio = null;
    }

    // 2) 신디사이저 인터벌 정지
    if (soundInterval) {
      clearInterval(soundInterval);
      soundInterval = null;
    }

    // 3) Web Audio 노드들 정리
    activeSoundNodes.forEach(node => {
      try {
        if (node.stop) node.stop();
        if (node.disconnect) node.disconnect();
      } catch (e) {
        // 이미 종료된 노드 무시
      }
    });
    activeSoundNodes = [];

    // 이퀄라이저 애니메이션 숨김
    audioEqualizer.classList.add('hidden');
  }

  function startAmbientSound(soundType) {
    stopAmbientSound();
    if (soundType === 'none') return;

    audioEqualizer.classList.remove('hidden');

    // 1순위: 실제 자연 고품질 음원 재생
    const audioUrl = SOUND_SOURCES[soundType];
    if (audioUrl) {
      try {
        currentAudio = new Audio(audioUrl);
        currentAudio.loop = true;
        currentAudio.volume = isMuted ? 0 : currentVolume;

        const playPromise = currentAudio.play();
        if (playPromise !== undefined) {
          playPromise
            .then(() => {
              // 정상 재생 시작
            })
            .catch(err => {
              console.warn(`[FocusFlow] 음원 자동 재생 실패, 신디사이저로 폴백:`, err);
              startSynthFallback(soundType);
            });
        }
      } catch (e) {
        startSynthFallback(soundType);
      }
    } else {
      startSynthFallback(soundType);
    }
  }

  // 오프라인이거나 네트워크 로드 지연 시 작동하는 Web Audio 신시사이저 폴백
  function startSynthFallback(soundType) {
    initAudioContext();
    if (!audioCtx) return;

    if (soundType === 'wave') {
      createWaveSound();
    } else if (soundType === 'rain') {
      createRainSound();
    } else if (soundType === 'snow') {
      createSnowSound();
    }
  }

  // 🌊 파도 소리 신디사이저
  function createWaveSound() {
    const bufferSize = audioCtx.sampleRate * 4;
    const noiseBuffer = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate);
    const output = noiseBuffer.getChannelData(0);
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;

    for (let i = 0; i < bufferSize; i++) {
      const white = Math.random() * 2 - 1;
      b0 = 0.99886 * b0 + white * 0.0555179;
      b1 = 0.99332 * b1 + white * 0.0750759;
      b2 = 0.96900 * b2 + white * 0.1538520;
      b3 = 0.86650 * b3 + white * 0.3104856;
      b4 = 0.55000 * b4 + white * 0.5329522;
      b5 = -0.7616 * b5 - white * 0.0168980;
      output[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362) * 0.15;
      b6 = white * 0.115926;
    }

    const whiteNoise = audioCtx.createBufferSource();
    whiteNoise.buffer = noiseBuffer;
    whiteNoise.loop = true;

    const filter = audioCtx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(350, audioCtx.currentTime);

    const lfo = audioCtx.createOscillator();
    lfo.type = 'sine';
    lfo.frequency.setValueAtTime(0.12, audioCtx.currentTime);

    const lfoGain = audioCtx.createGain();
    lfoGain.gain.setValueAtTime(280, audioCtx.currentTime);

    lfo.connect(lfoGain);
    lfoGain.connect(filter.frequency);

    whiteNoise.connect(filter);
    filter.connect(ambientGainNode);

    whiteNoise.start();
    lfo.start();

    activeSoundNodes.push(whiteNoise, lfo, filter, lfoGain);
  }

  // 🌧️ 빗소리 신디사이저
  function createRainSound() {
    const bufferSize = audioCtx.sampleRate * 2;
    const noiseBuffer = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate);
    const output = noiseBuffer.getChannelData(0);

    for (let i = 0; i < bufferSize; i++) {
      output[i] = (Math.random() * 2 - 1) * 0.22;
    }

    const noise = audioCtx.createBufferSource();
    noise.buffer = noiseBuffer;
    noise.loop = true;

    const lowpass = audioCtx.createBiquadFilter();
    lowpass.type = 'lowpass';
    lowpass.frequency.setValueAtTime(1400, audioCtx.currentTime);

    const highpass = audioCtx.createBiquadFilter();
    highpass.type = 'highpass';
    highpass.frequency.setValueAtTime(250, audioCtx.currentTime);

    noise.connect(lowpass);
    lowpass.connect(highpass);
    highpass.connect(ambientGainNode);

    noise.start();
    activeSoundNodes.push(noise, lowpass, highpass);
  }

  // ❄️ 뽀드득 눈 밟는 소리 신디사이저
  function createSnowSound() {
    const step = () => {
      if (!audioCtx || currentSound !== 'snow') return;
      const now = audioCtx.currentTime;

      // 뽀드득 밟는 노이즈 버퍼
      const crunchDuration = 0.35;
      const bufferSize = Math.floor(audioCtx.sampleRate * crunchDuration);
      const noiseBuffer = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate);
      const output = noiseBuffer.getChannelData(0);

      for (let i = 0; i < bufferSize; i++) {
        output[i] = (Math.random() * 2 - 1) * Math.sin(Math.PI * (i / bufferSize));
      }

      const noise = audioCtx.createBufferSource();
      noise.buffer = noiseBuffer;

      const bandpass = audioCtx.createBiquadFilter();
      bandpass.type = 'bandpass';
      bandpass.frequency.setValueAtTime(1500 + Math.random() * 400, now);
      bandpass.Q.setValueAtTime(2.5, now);

      const gain = audioCtx.createGain();
      gain.gain.setValueAtTime(0, now);
      gain.gain.linearRampToValueAtTime(0.4, now + 0.04);
      gain.gain.exponentialRampToValueAtTime(0.001, now + crunchDuration);

      noise.connect(bandpass);
      bandpass.connect(gain);
      gain.connect(ambientGainNode);

      noise.start(now);
      noise.stop(now + crunchDuration);
    };

    step();
    soundInterval = setInterval(() => {
      step();
      // 사람 발자국 2걸음 리듬 (왼발-오른발)
      setTimeout(step, 450);
    }, 1800);
  }

  // 7. 세션 카운터 로컬 스토리지 관리
  function loadSessionCount() {
    const saved = localStorage.getItem('focusflow_sessions');
    completedSessions = saved ? parseInt(saved, 10) : 0;
    sessionCountEl.textContent = completedSessions;
  }

  function incrementSessionCount() {
    completedSessions += 1;
    sessionCountEl.textContent = completedSessions;
    localStorage.setItem('focusflow_sessions', completedSessions.toString());
  }

  function resetSessionCount() {
    if (confirm('완료한 세션 카운터를 0으로 초기화하시겠습니까?')) {
      completedSessions = 0;
      sessionCountEl.textContent = '0';
      localStorage.setItem('focusflow_sessions', '0');
    }
  }

  // 8. 디스플레이 렌더링 (원형 링, 시계, 탭 타이틀)
  function formatTime(seconds) {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }

  function updateDisplay() {
    const formatted = formatTime(timeLeft);
    timeDisplay.textContent = formatted;

    // 프로그레스 링 계산 (남은 비율: 1.0 -> 0.0)
    const totalDuration = currentMode === 'focus' ? FOCUS_TIME : BREAK_TIME;
    const progress = timeLeft / totalDuration;
    // 12시 방향부터 시간이 줄어들면서 링이 점진적으로 지워지는 자연스러운 효과
    const offset = CIRCLE_CIRCUMFERENCE * (1 - progress);
    progressRing.style.strokeDashoffset = offset;

    // 브라우저 탭 타이틀 실시간 동기화
    const modeLabel = currentMode === 'focus' ? '🎯 집중 중' : '☕ 달콤한 휴식';
    const statePrefix = isRunning ? '' : '⏸️ ';
    document.title = `${statePrefix}(${formatted}) ${modeLabel} | FocusFlow`;
  }

  // 9. 테마 및 모드 전환
  function applyTheme(mode) {
    currentMode = mode;
    if (mode === 'focus') {
      body.className = 'mode-focus';
      modeText.textContent = '집중 시간 (Focus)';
      timeSubtext.textContent = '25분 동안 온전히 집중하세요';
      timeLeft = FOCUS_TIME;
    } else {
      body.className = 'mode-break';
      modeText.textContent = '달콤한 휴식 (Break)';
      timeSubtext.textContent = '5분 동안 가볍게 스트레칭하고 숨을 고르세요';
      timeLeft = BREAK_TIME;
    }
    updateDisplay();
  }

  function switchModeAutomatically() {
    // 알림음 울리기
    playAlarmChime();

    if (currentMode === 'focus') {
      // 25분 집중 세션 완료 -> 세션 카운터 +1 증가
      incrementSessionCount();
      // 5분 휴식으로 자동 전환
      applyTheme('break');
    } else {
      // 5분 휴식 세션 완료 -> 25분 집중으로 자동 전환
      applyTheme('focus');
    }

    // 자동 전환 후 바로 타이머 시작 (한 세트로 자동 연속 구동)
    startTimer();
  }

  // 10. 타이머 제어 함수
  function startTimer() {
    if (isRunning) return;

    initAudioContext();
    isRunning = true;

    // UI 토글 (시작 -> 일시정지)
    playIcon.classList.add('hidden');
    pauseIcon.classList.remove('hidden');
    startPauseText.textContent = '일시정지';
    startPauseBtn.setAttribute('title', '타이머 일시정지');

    // 1초 인터벌 실행
    timerInterval = setInterval(() => {
      if (timeLeft > 0) {
        timeLeft -= 1;
        updateDisplay();
      } else {
        // 시간 완료 (00:00 도달)
        clearInterval(timerInterval);
        timerInterval = null;
        isRunning = false;
        switchModeAutomatically();
      }
    }, 1000);

    updateDisplay();
  }

  function pauseTimer() {
    if (!isRunning) return;

    isRunning = false;
    clearInterval(timerInterval);
    timerInterval = null;

    // UI 토글 (일시정지 -> 시작/재개)
    playIcon.classList.remove('hidden');
    pauseIcon.classList.add('hidden');
    startPauseText.textContent = '이어서 시작';
    startPauseBtn.setAttribute('title', '타이머 재개');

    updateDisplay();
  }

  function toggleStartPause() {
    if (isRunning) {
      pauseTimer();
    } else {
      startTimer();
    }
  }

  function resetTimer() {
    pauseTimer();
    timeLeft = currentMode === 'focus' ? FOCUS_TIME : BREAK_TIME;
    startPauseText.textContent = '시작하기';
    updateDisplay();
  }

  function skipSession() {
    pauseTimer();
    if (confirm(`현재 [${currentMode === 'focus' ? '집중' : '휴식'}] 세션을 건너뛰고 다음으로 전환할까요?`)) {
      if (currentMode === 'focus') {
        applyTheme('break');
      } else {
        applyTheme('focus');
      }
      resetTimer();
    }
  }

  // 11. 볼륨 및 음소거 제어
  function updateVolume(val) {
    currentVolume = val / 100;
    volumeLevelText.textContent = `${val}%`;
    volumeTrackFill.style.width = `${val}%`;

    // 1) 온라인 자연 음원 볼륨 반영
    if (currentAudio) {
      currentAudio.volume = isMuted ? 0 : currentVolume;
    }

    // 2) Web Audio 신디사이저 볼륨 반영
    if (ambientGainNode && audioCtx) {
      if (!isMuted) {
        ambientGainNode.gain.setValueAtTime(currentVolume, audioCtx.currentTime);
      }
    }

    if (val === 0) {
      setMuted(true);
    } else if (isMuted) {
      setMuted(false);
    }
  }

  function setMuted(muted) {
    isMuted = muted;
    if (isMuted) {
      volumeIcon.classList.add('hidden');
      muteIcon.classList.remove('hidden');
      if (currentAudio) {
        currentAudio.volume = 0;
      }
      if (ambientGainNode && audioCtx) {
        ambientGainNode.gain.setValueAtTime(0, audioCtx.currentTime);
      }
    } else {
      volumeIcon.classList.remove('hidden');
      muteIcon.classList.add('hidden');
      if (currentAudio) {
        currentAudio.volume = currentVolume;
      }
      if (ambientGainNode && audioCtx) {
        ambientGainNode.gain.setValueAtTime(currentVolume, audioCtx.currentTime);
      }
    }
  }

  function toggleMute() {
    initAudioContext();
    if (isMuted) {
      setMuted(false);
      if (currentVolume === 0) {
        volumeSlider.value = 50;
        updateVolume(50);
      }
    } else {
      setMuted(true);
    }
  }

  // 12. 이벤트 리스너 등록
  function setupEventListeners() {
    // 타이머 제어 버튼
    startPauseBtn.addEventListener('click', toggleStartPause);
    resetBtn.addEventListener('click', resetTimer);
    skipBtn.addEventListener('click', skipSession);
    resetSessionBtn.addEventListener('click', resetSessionCount);

    // 사운드 칩 선택
    soundChips.forEach(chip => {
      chip.addEventListener('click', () => {
        soundChips.forEach(c => {
          c.classList.remove('active');
          c.setAttribute('aria-checked', 'false');
        });
        chip.classList.add('active');
        chip.setAttribute('aria-checked', 'true');

        const sound = chip.getAttribute('data-sound');
        currentSound = sound;
        startAmbientSound(sound);
      });
    });

    // 볼륨 슬라이더
    volumeSlider.addEventListener('input', (e) => {
      updateVolume(parseInt(e.target.value, 10));
    });

    // 음소거 토글
    muteBtn.addEventListener('click', toggleMute);

    // 키보드 단축키 지원 (스페이스바: 시작/일시정지, R: 리셋)
    window.addEventListener('keydown', (e) => {
      if (e.target.tagName === 'INPUT') return;
      if (e.code === 'Space') {
        e.preventDefault();
        toggleStartPause();
      } else if (e.key === 'r' || e.key === 'R') {
        resetTimer();
      }
    });
  }

  // 13. 초기화 (Init)
  function init() {
    loadSessionCount();
    applyTheme('focus');
    updateVolume(60);
    setupEventListeners();
  }

  init();
})();
