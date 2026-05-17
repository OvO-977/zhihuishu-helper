// ==UserScript==
// @name         智慧树助手
// @version      1.2
// @description  智慧树视频倍速、暂停后继续播放、播放结束后从头播放或播放下一个视频。
// @match        *://*.zhihuishu.com/*
// @match        *://*.zhihuishu.com/*/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  const STORAGE_KEY = 'zhihuishu_classroom_playback_rate';
  const SPEEDS = [1, 1.25, 1.5, 3];

  const AUTO_RESUME_DELAY = 2000;
  const AUTO_NEXT_DELAY = 2000;

  let currentRate = Number(localStorage.getItem(STORAGE_KEY)) || 1;

  let resumeTimer = null;
  let nextTimer = null;

  function getVideo() {
    return document.querySelector('video');
  }

  function applySpeed(video) {
    if (!video) return;

    if (Math.abs(video.playbackRate - currentRate) > 0.01) {
      video.playbackRate = currentRate;
    }
  }

  async function safePlay(video) {
    if (!video) return;

    applySpeed(video);

    if (video.ended) return;

    try {
      await video.play();
    } catch (err) {
      console.warn('[智慧树助手] 自动播放失败，可能被浏览器或平台拦截。请手动点击一次页面或右下角图标。', err);
    }
  }

  function isVisible(el) {
    return !!(
      el &&
      (el.offsetWidth || el.offsetHeight || el.getClientRects().length)
    );
  }

  function isVideoFileItem(el) {
    if (!el) return false;

    return (
      el.classList &&
      el.classList.contains('file-item') &&
      !!el.querySelector('.icon-video')
    );
  }

  function findCurrentVideoItem() {
    const active = document.querySelector('.file-item.active');

    if (active && isVideoFileItem(active)) {
      return active;
    }

    return null;
  }

  function getVideoItemProgress(fileItem) {
    if (!fileItem) return null;

    if (fileItem.querySelector('.status-box .icon-finish')) {
      return 100;
    }

    const rate = fileItem.querySelector('.status-box .rate');
    const text = rate ? rate.textContent : '';
    const match = text.match(/(\d+(?:\.\d+)?)\s*%/);

    if (!match) return null;

    const progress = Number(match[1]);

    if (!Number.isFinite(progress)) return null;

    return Math.max(0, Math.min(100, progress));
  }

  function isVideoItemIncomplete(fileItem) {
    return getVideoItemProgress(fileItem) !== 100;
  }

  function isCurrentVideoProgressIncomplete() {
    const progress = getVideoItemProgress(findCurrentVideoItem());

    return progress !== null && progress < 100;
  }

  function getSourceTree() {
    return (
      document.querySelector('#sourceTree') ||
      document.querySelector('.source-list .nano-content') ||
      document
    );
  }

  function findNextIncompleteVideoInCourseTree(currentItem) {
    if (!currentItem) return null;

    const videoItems = Array.from(
      getSourceTree().querySelectorAll('.file-item')
    ).filter(isVideoFileItem);
    const currentIndex = videoItems.indexOf(currentItem);

    if (!videoItems.length || currentIndex === -1) {
      return null;
    }

    for (let offset = 1; offset < videoItems.length; offset += 1) {
      const candidate = videoItems[(currentIndex + offset) % videoItems.length];

      if (isVideoItemIncomplete(candidate)) {
        return candidate;
      }
    }

    return null;
  }

  function getFileId(fileItem) {
    if (!fileItem || !fileItem.id) return null;

    const match = fileItem.id.match(/^file_(\d+)$/);
    return match ? match[1] : null;
  }

  function clickVideoItem(fileItem) {
    if (!fileItem) return false;

    const fileId = getFileId(fileItem);

    fileItem.scrollIntoView({
      behavior: 'smooth',
      block: 'center'
    });

    console.log('[智慧树助手] 准备切换到视频：', fileItem.innerText, fileItem);

    if (fileId && typeof window.changeFile === 'function') {
      window.changeFile(Number(fileId));
      return true;
    }

    fileItem.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    fileItem.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    fileItem.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    fileItem.click();

    return true;
  }

  function goNextVideo() {
    const currentItem = findCurrentVideoItem();

    if (!currentItem) {
      console.warn('[智慧树助手] 没找到当前正在播放的视频目录项：.file-item.active');
      return;
    }

    const nextVideoItem = findNextIncompleteVideoInCourseTree(currentItem);

    if (!nextVideoItem) {
      console.warn('[智慧树助手] 没找到后续视频，可能已经是最后一个视频。');
      return;
    }

    clickVideoItem(nextVideoItem);

    setTimeout(() => {
      const video = getVideo();

      if (video) {
        applySpeed(video);
        safePlay(video);
      }
    }, 1800);
  }

  function isNotFinished(video) {
    return !!(
      video &&
      video.duration &&
      Number.isFinite(video.duration) &&
      video.currentTime < video.duration - 2
    );
  }

  function replayCurrentVideo(video) {
    if (!video) return;

    try {
      video.currentTime = 0;
    } catch (err) {
      console.warn('[智慧树助手] 当前视频已播到末尾但进度未满，重置播放进度失败。', err);
    }

    setTimeout(() => {
      safePlay(video);
    }, 100);
  }

  function scheduleResumeIfStillPaused() {
    if (resumeTimer) return;

    resumeTimer = setTimeout(() => {
      resumeTimer = null;

      const video = getVideo();
      if (!video) return;

      if (isNotFinished(video) && video.paused) {
        console.log('[智慧树助手] 视频已暂停 2 秒，确认仍未播放完，尝试自动继续播放。');
        safePlay(video);
      }
    }, AUTO_RESUME_DELAY);
  }

  function scheduleNextIfStillEnded() {
    if (nextTimer) return;

    nextTimer = setTimeout(() => {
      nextTimer = null;

      const video = getVideo();

      if (video && video.ended) {
        if (isCurrentVideoProgressIncomplete()) {
          console.log('[智慧树助手] 当前视频已播到末尾但进度未满，从头重新播放当前视频。');
          replayCurrentVideo(video);
          return;
        }

        console.log('[智慧树助手] 视频结束已持续 2 秒，确认切换到下一个视频。');
        goNextVideo();
      }
    }, AUTO_NEXT_DELAY);
  }

  function clearResumeTimer() {
    if (resumeTimer) {
      clearTimeout(resumeTimer);
      resumeTimer = null;
    }
  }

  function clearNextTimer() {
    if (nextTimer) {
      clearTimeout(nextTimer);
      nextTimer = null;
    }
  }

  function attachVideoEvents(video) {
    if (!video || video.dataset.zhihuishuHelperAttached === '1') return;

    video.dataset.zhihuishuHelperAttached = '1';

    applySpeed(video);

    video.addEventListener('ratechange', () => {
      applySpeed(video);
    });

    video.addEventListener('play', () => {
      clearResumeTimer();
      clearNextTimer();
    });

    video.addEventListener('pause', () => {
      scheduleResumeIfStillPaused();
    });

    video.addEventListener('ended', () => {
      console.log('[智慧树助手] 当前视频播放结束，2 秒后确认是否切换下一个视频。');
      scheduleNextIfStillEnded();
    });

    console.log('[智慧树助手] 已绑定视频事件。');
  }

  function scanVideo() {
    const video = getVideo();

    if (!video) return;

    attachVideoEvents(video);
    applySpeed(video);

    if (isNotFinished(video) && video.paused) {
      scheduleResumeIfStillPaused();
    }

    if (video.ended) {
      scheduleNextIfStillEnded();
    }
  }

  function createPanel() {
    if (document.querySelector('#zhs-classroom-helper')) return;

    const style = document.createElement('style');

    style.textContent = `
      #zhs-classroom-helper {
        position: fixed;
        right: 24px;
        bottom: 90px;
        z-index: 999999;
        font-family: Arial, "Microsoft YaHei", sans-serif;
      }

      #zhs-classroom-helper .main-btn {
        width: 54px;
        height: 54px;
        border-radius: 50%;
        border: none;
        background: #1677ff;
        color: white;
        font-size: 22px;
        cursor: pointer;
        box-shadow: 0 4px 14px rgba(0, 0, 0, .25);
      }

      #zhs-classroom-helper .menu {
        display: none;
        position: absolute;
        right: 0;
        bottom: 64px;
        width: 170px;
        padding: 10px;
        border-radius: 12px;
        background: white;
        box-shadow: 0 4px 18px rgba(0, 0, 0, .22);
        color: #333;
      }

      #zhs-classroom-helper.open .menu {
        display: block;
      }

      #zhs-classroom-helper .title {
        font-size: 13px;
        margin-bottom: 8px;
        color: #555;
      }

      #zhs-classroom-helper .speed-btn {
        width: 100%;
        margin: 4px 0;
        padding: 7px 8px;
        border: 1px solid #ddd;
        border-radius: 8px;
        background: #f7f7f7;
        cursor: pointer;
        font-size: 14px;
      }

      #zhs-classroom-helper .speed-btn.active {
        background: #1677ff;
        color: white;
        border-color: #1677ff;
      }

      #zhs-classroom-helper .manual-next-btn {
        width: 100%;
        margin: 8px 0 4px;
        padding: 7px 8px;
        border: 1px solid #1677ff;
        border-radius: 8px;
        background: white;
        color: #1677ff;
        cursor: pointer;
        font-size: 14px;
      }

      #zhs-classroom-helper .hint {
        margin-top: 8px;
        font-size: 12px;
        color: #777;
        line-height: 1.4;
      }
    `;

    document.head.appendChild(style);

    const box = document.createElement('div');
    box.id = 'zhs-classroom-helper';

    const menu = document.createElement('div');
    menu.className = 'menu';

    const title = document.createElement('div');
    title.className = 'title';
    title.textContent = '播放倍速';
    menu.appendChild(title);

    SPEEDS.forEach(speed => {
      const btn = document.createElement('button');
      btn.className = 'speed-btn';
      btn.textContent = `${speed}x`;
      btn.dataset.speed = String(speed);

      if (speed === currentRate) {
        btn.classList.add('active');
      }

      btn.addEventListener('click', () => {
        currentRate = speed;
        localStorage.setItem(STORAGE_KEY, String(speed));

        document
          .querySelectorAll('#zhs-classroom-helper .speed-btn')
          .forEach(b => {
            b.classList.toggle(
              'active',
              Number(b.dataset.speed) === currentRate
            );
          });

        const video = getVideo();

        if (video) {
          applySpeed(video);
          safePlay(video);
        }
      });

      menu.appendChild(btn);
    });

    const nextBtn = document.createElement('button');
    nextBtn.className = 'manual-next-btn';
    nextBtn.textContent = '手动跳到下个视频';
    nextBtn.addEventListener('click', () => {
      goNextVideo();
    });
    menu.appendChild(nextBtn);

    const hint = document.createElement('div');
    hint.className = 'hint';
    hint.textContent = '暂停 2 秒后会自动续播，视频结束 2 秒后会按 file-item 顺序播放下一个 icon-video。';
    menu.appendChild(hint);

    const mainBtn = document.createElement('button');
    mainBtn.className = 'main-btn';
    mainBtn.title = '智慧树课堂播放助手';
    mainBtn.textContent = '\u25B6';

    mainBtn.addEventListener('click', () => {
      box.classList.toggle('open');

      const video = getVideo();

      if (video) {
        applySpeed(video);
        safePlay(video);
      }
    });

    box.appendChild(menu);
    box.appendChild(mainBtn);
    document.body.appendChild(box);
  }

  createPanel();

  setInterval(scanVideo, 1200);

  const observer = new MutationObserver(() => {
    scanVideo();
  });

  observer.observe(document.documentElement, {
    childList: true,
    subtree: true
  });

  scanVideo();
})();