import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Share, PlusSquare, X } from 'lucide-react';

export function PWAInstaller() {
  const [showAndroidInstall, setShowAndroidInstall] = useState(false);
  const [showIosInstall, setShowIosInstall] = useState(false);
  const [isDismissed, setIsDismissed] = useState(false);

  useEffect(() => {
    if (isDismissed) return;

    // Check if already installed
    if (window.matchMedia('(display-mode: standalone)').matches || (window.navigator as any).standalone) {
      return;
    }

    // Android / Desktop check
    const checkAndroidPrompt = () => {
      if ((window as any).deferredPWAInstallPrompt) {
        setShowAndroidInstall(true);
      }
    };
    
    checkAndroidPrompt();
    window.addEventListener('beforeinstallprompt', checkAndroidPrompt);

    // iOS check
    const isIos = /ipad|iphone|ipod/.test(navigator.userAgent.toLowerCase());
    if (isIos && !(window.navigator as any).standalone) {
      setShowIosInstall(true);
    }

    return () => {
      window.removeEventListener('beforeinstallprompt', checkAndroidPrompt);
    };
  }, [isDismissed]);

  const handleInstallClick = async () => {
    const promptEvent = (window as any).deferredPWAInstallPrompt;
    if (promptEvent) {
      promptEvent.prompt();
      const result = await promptEvent.userChoice;
      if (result.outcome === 'accepted') {
        setShowAndroidInstall(false);
      }
      (window as any).deferredPWAInstallPrompt = null;
    }
  };

  const handleDismiss = () => {
    setIsDismissed(true);
    setShowAndroidInstall(false);
    setShowIosInstall(false);
  };

  if (!showAndroidInstall && !showIosInstall) return null;

  return (
    <AnimatePresence>
      <motion.div 
        initial={{ y: 100, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: 100, opacity: 0 }}
        className="fixed bottom-0 left-0 right-0 p-4 z-50 flex justify-center"
      >
        <div className="bg-white border border-[#552c24]/20 rounded-2xl shadow-2xl p-4 max-w-sm w-full flex items-center justify-between gap-4 relative">
          <button 
            onClick={handleDismiss}
            className="absolute top-2 right-2 text-gray-400 hover:text-gray-600"
          >
            <X size={16} />
          </button>
          
          <div className="w-12 h-12 flex-shrink-0 bg-gray-100 rounded-xl overflow-hidden shadow-sm">
            <img src="/icon.png" alt="App Icon" className="w-full h-full object-cover" />
          </div>
          
          <div className="flex-1 pt-1">
            <h4 className="font-bold text-[#552c24] text-lg leading-none">오리 실장</h4>
            {showIosInstall ? (
              <div className="text-xs text-[#552c24]/80 mt-1.5 flex flex-col gap-1">
                <span>앱으로 설치해서 빠르게 이용하세요!</span>
                <span className="flex items-center gap-1 font-medium bg-gray-50 px-2 py-1 rounded-md mt-0.5">
                  <Share size={12} className="text-blue-500" /> 공유 버튼 누르고 <br/>
                  <PlusSquare size={12} className="text-gray-600" /> 홈 화면에 추가
                </span>
              </div>
            ) : (
              <p className="text-xs text-[#552c24]/80 mt-1 font-medium">홈 화면에 추가하여 빠르게 실행하세요!</p>
            )}
          </div>

          {showAndroidInstall && (
            <button 
              onClick={handleInstallClick}
              className="bg-[#ffcd4a] text-[#552c24] px-4 py-2 rounded-xl font-bold text-sm hover:bg-[#ffcd4a]/90 active:scale-95 transition-all shadow-md flex-shrink-0"
            >
              설치
            </button>
          )}
        </div>
      </motion.div>
    </AnimatePresence>
  );
}
