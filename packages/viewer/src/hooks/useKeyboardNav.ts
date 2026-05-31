import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

/**
 * Global keyboard shortcuts:
 *   Left/Right Arrow - paginate (triggers prev/next page buttons)
 *   Esc             - navigate back (only when no overlay is open)
 */
export function useKeyboardNav() {
  const navigate = useNavigate();

  useEffect(() => {
    function handler(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (document.querySelector('[data-lightbox]')) return;

      switch (e.key) {
        case 'ArrowLeft': {
          const prevBtn = document.querySelector<HTMLButtonElement>('[data-kbd="prev"]');
          if (prevBtn && !prevBtn.disabled) { prevBtn.click(); e.preventDefault(); }
          break;
        }
        case 'ArrowRight': {
          const nextBtn = document.querySelector<HTMLButtonElement>('[data-kbd="next"]');
          if (nextBtn && !nextBtn.disabled) { nextBtn.click(); e.preventDefault(); }
          break;
        }
        case 'Escape':
          navigate(-1);
          e.preventDefault();
          break;
      }
    }

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [navigate]);
}
