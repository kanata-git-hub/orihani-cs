import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';

export function SplashScreen({ onFinish }: { onFinish: () => void }) {
  const [isVisible, setIsVisible] = useState(true);

  useEffect(() => {
    // Show splash screen for 2.5 seconds
    const timer = setTimeout(() => {
      setIsVisible(false);
      setTimeout(onFinish, 500); // Allow exit animation to complete
    }, 2500);
    
    return () => clearTimeout(timer);
  }, [onFinish]);

  return (
    <AnimatePresence>
      {isVisible && (
        <motion.div
          initial={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.5 }}
          className="fixed inset-0 z-[9999] bg-[#fdfbf7] flex flex-col items-center justify-center"
        >
          <motion.div
            initial={{ scale: 0.8, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ duration: 0.8, ease: "easeOut" }}
            className="flex flex-col items-center gap-6"
          >
            <div className="w-[250px] h-[250px] overflow-hidden rounded-[2rem] shadow-2xl border-[6px] border-white/50 bg-white">
              <img src="/icon.png" alt="오리 실장" className="w-full h-full object-cover" />
            </div>
            <h1 
              className="text-[#552c24] text-[32px] tracking-wide font-bold"
              style={{ fontFamily: "'KyoboHandwriting2024psw', sans-serif" }}
            >
              오리 실장
            </h1>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
