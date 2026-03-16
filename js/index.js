// Panel flip functionality for mobile/touch devices
(function() {
  const panels = document.querySelectorAll('.panel');

  panels.forEach(panel => {
    const flipCard = panel.querySelector('.flip-card');
    let isFlipped = false;

    // Check if device supports touch
    const isTouchDevice = 'ontouchstart' in window || navigator.maxTouchPoints > 0;

    if (isTouchDevice && flipCard) {
      panel.addEventListener('click', function(e) {
        e.preventDefault();
        isFlipped = !isFlipped;

        if (isFlipped) {
          flipCard.style.transform = 'rotateX(180deg)';
          panel.classList.add('flipped');
        } else {
          flipCard.style.transform = 'rotateX(0deg)';
          panel.classList.remove('flipped');
        }
      });
    }
  });
})();

// Accordion functionality
(function() {
  const accordionHeaders = document.querySelectorAll('.accordion-header');

  accordionHeaders.forEach(header => {
    header.addEventListener('click', function() {
      const accordionItem = this.parentElement;
      const isActive = accordionItem.classList.contains('active');

      // Close all accordion items
      document.querySelectorAll('.accordion-item').forEach(item => {
        item.classList.remove('active');
      });

      // Open clicked item if it wasn't active
      if (!isActive) {
        accordionItem.classList.add('active');
      }
    });
  });
})();

// Toggle mobile menu — smooth slide open/close using max-height (no layout changes)
(function() {
  const toggleBtn = document.querySelector('.menu-toggle');
  const mobileMenu = document.querySelector('.mobile-menu');
  const header = document.querySelector('.header');

  if (!toggleBtn || !mobileMenu) return;

  // Ensure starting collapsed state
  mobileMenu.style.maxHeight = '0px';
  mobileMenu.style.overflow = 'hidden';
  mobileMenu.style.paddingTop = '0';
  mobileMenu.style.paddingBottom = '0';
  mobileMenu.setAttribute('aria-hidden', 'true');
  toggleBtn.setAttribute('aria-expanded', 'false');

  function openMenu() {
    // add class so .mobile-menu.show styles (if any) apply
    mobileMenu.classList.add('show');

    // set padding so contents are visible during animation
    mobileMenu.style.paddingTop = '';
    mobileMenu.style.paddingBottom = '';

    // measure and animate
    const full = mobileMenu.scrollHeight + 'px';
    mobileMenu.style.maxHeight = full;
    mobileMenu.setAttribute('aria-hidden', 'false');
    toggleBtn.setAttribute('aria-expanded', 'true');
  }

  function closeMenu() {
    // set current height explicitly (needed in some browsers)
    mobileMenu.style.maxHeight = mobileMenu.scrollHeight + 'px';

    // next frame, animate to 0
    requestAnimationFrame(() => {
      mobileMenu.style.maxHeight = '0px';
      mobileMenu.style.paddingTop = '0';
      mobileMenu.style.paddingBottom = '0';
    });

    toggleBtn.setAttribute('aria-expanded', 'false');
    mobileMenu.setAttribute('aria-hidden', 'true');

    // after transition remove .show so desktop CSS isn't affected
    const onEnd = (e) => {
      if (e.propertyName === 'max-height') {
        mobileMenu.classList.remove('show');
        mobileMenu.removeEventListener('transitionend', onEnd);
        // clear inline maxHeight so desktop layout isn't constrained
        mobileMenu.style.maxHeight = '';
      }
    };
    mobileMenu.addEventListener('transitionend', onEnd);
  }

  toggleBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (mobileMenu.classList.contains('show')) closeMenu();
    else openMenu();
  });

  // Close when clicking any mobile menu link
  mobileMenu.addEventListener('click', (e) => {
    const target = e.target;
    if (target.tagName === 'A') {
      // allow navigation to start, then close
      setTimeout(closeMenu, 120);
    }
  });

  // Click outside to close (but ignore clicks inside header/mobile menu)
  document.addEventListener('click', (e) => {
    const inHeader = header.contains(e.target);
    const inMobile = mobileMenu.contains(e.target);
    if (!inHeader && !inMobile && mobileMenu.classList.contains('show')) {
      closeMenu();
    }
  });

  // Close menu on resize back to desktop
  window.addEventListener('resize', () => {
    if (window.innerWidth > 768 && mobileMenu.classList.contains('show')) {
      // instantly close (no animation)
      mobileMenu.classList.remove('show');
      mobileMenu.style.maxHeight = '';
      mobileMenu.style.paddingTop = '';
      mobileMenu.style.paddingBottom = '';
      mobileMenu.setAttribute('aria-hidden', 'true');
      toggleBtn.setAttribute('aria-expanded', 'false');
    }
  });
})();


// Reveal on scroll for Who We Are and Accordion
(function() {
  const revealEls = document.querySelectorAll('.reveal');
  if (!revealEls.length || !('IntersectionObserver' in window)) {
    // Fallback: show immediately
    revealEls.forEach(el => el.classList.add('is-visible'));
    return;
  }

  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add('is-visible');
      } else {
        entry.target.classList.remove('is-visible');
      }
    });
  }, { threshold: 0.12, rootMargin: "-25% 0px -25% 0px" });

  revealEls.forEach(el => observer.observe(el));
})();

