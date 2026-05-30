import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

/**
 * Global keyboard shortcuts:
 *   Left/Right Arrow - paginate (triggers prev/next page buttons)
 *   J/K             - scroll main content down/up
 *   Esc             - navigate back
 */
export function useKeyboardNav() {
  const navigate = useNavigate();

  useEffect(() => {
    function handler(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

      const main = document.querySelector('main');

      switch (e.key) {
        case 'ArrowLeft': {
          const prevBtn = document.querySelector<HTMLButtonElement>('[data-kbd="prev"]');
          if (prevBtn && !prevBtn.disabled) { prevBtn.click(); e.preventDefault(); }
          break;
        }
        case 'ArrowRight': {
          const nextBtn = document.querySelector<HTMLButtonElement>(
            '[data-kbd="next"]'
          );
          if (nextBtn && !nextBtn.disabled) { nextBtn.click(); e.preventDefault(); }
          break;
        }
        case 'j':
        case 'J':
          if (main) { main.scrollBy({ top: 200, behavior: 'smooth' }); e.preventDefault(); }
          break;
        case 'k':
        case 'K':
          if (main) { main.scrollBy({ top: -200, behavior: 'smooth' }); e.preventDefault(); }
          break;
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
