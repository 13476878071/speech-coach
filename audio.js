let activeUtterance = null;

export function audioPreviewSupported() {
  return "speechSynthesis" in window && "SpeechSynthesisUtterance" in window;
}

export function stopAudioPreview() {
  if (!audioPreviewSupported()) return;
  activeUtterance = null;
  window.speechSynthesis.cancel();
}

export function playAudioPreview(sentence, pace, reportStatus) {
  if (!audioPreviewSupported()) return false;
  stopAudioPreview();

  const utterance = new SpeechSynthesisUtterance(sentence);
  activeUtterance = utterance;
  utterance.lang = "en-US";
  utterance.rate = pace === "slow" ? 0.72 : 1;
  utterance.onstart = () => {
    if (activeUtterance === utterance) reportStatus("正在播放浏览器语音预览…");
  };
  utterance.onend = () => {
    if (activeUtterance === utterance) {
      activeUtterance = null;
      reportStatus("播放结束。");
    }
  };
  utterance.onerror = () => {
    if (activeUtterance === utterance) {
      activeUtterance = null;
      reportStatus("语音预览暂时无法播放，请检查浏览器的语音设置。");
    }
  };

  try {
    reportStatus("正在准备浏览器语音预览…");
    window.speechSynthesis.speak(utterance);
    return true;
  } catch {
    activeUtterance = null;
    reportStatus("语音预览暂时无法播放，请检查浏览器的语音设置。");
    return false;
  }
}
