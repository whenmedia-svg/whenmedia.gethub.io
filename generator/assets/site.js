/* site.js — modal pop-ups (photo essay / audio / video) + small niceties.
   Plain vanilla JavaScript, no libraries. */

(function () {
  'use strict';

  var openModal = null;

  function show(modal) {
    modal.classList.add('is-open');
    document.body.classList.add('modal-open');
    openModal = modal;

    // Video: load the iframe only when the modal opens
    var iframe = modal.querySelector('iframe[data-src]');
    if (iframe && !iframe.src) iframe.src = iframe.getAttribute('data-src');

    var closeBtn = modal.querySelector('.modal-close');
    if (closeBtn) closeBtn.focus();
  }

  function hide(modal) {
    modal.classList.remove('is-open');
    document.body.classList.remove('modal-open');
    openModal = null;

    // Stop any playing media
    var iframe = modal.querySelector('iframe[data-src]');
    if (iframe && iframe.src) iframe.removeAttribute('src');
    var audio = modal.querySelector('audio');
    if (audio) audio.pause();
  }

  document.addEventListener('click', function (e) {
    // Open
    var trigger = e.target.closest('[data-modal]');
    if (trigger) {
      e.preventDefault();
      var modal = document.getElementById(trigger.getAttribute('data-modal'));
      if (modal) show(modal);
      return;
    }
    if (!openModal) return;

    // Close button or click on the dark backdrop
    if (e.target.closest('.modal-close') || e.target.classList.contains('modal-overlay')) {
      hide(openModal);
      return;
    }

    // Slideshow arrows
    var arrow = e.target.closest('[data-slide]');
    if (arrow) step(openModal, arrow.getAttribute('data-slide') === 'next' ? 1 : -1);
  });

  document.addEventListener('keydown', function (e) {
    if (!openModal) return;
    if (e.key === 'Escape') hide(openModal);
    if (e.key === 'ArrowRight') step(openModal, 1);
    if (e.key === 'ArrowLeft') step(openModal, -1);
  });

  function step(modal, delta) {
    var slides = modal.querySelectorAll('.slide');
    if (slides.length < 2) return;
    var current = 0;
    slides.forEach(function (s, i) { if (s.classList.contains('is-active')) current = i; });
    slides[current].classList.remove('is-active');
    var next = (current + delta + slides.length) % slides.length;
    slides[next].classList.add('is-active');
    var counter = modal.querySelector('.slide-counter');
    if (counter) counter.textContent = (next + 1) + ' of ' + slides.length;
  }

  // Basic swipe support for slideshows on touch screens
  var touchX = null;
  document.addEventListener('touchstart', function (e) {
    if (openModal) touchX = e.touches[0].clientX;
  }, { passive: true });
  document.addEventListener('touchend', function (e) {
    if (openModal && touchX !== null) {
      var dx = e.changedTouches[0].clientX - touchX;
      if (Math.abs(dx) > 50) step(openModal, dx < 0 ? 1 : -1);
    }
    touchX = null;
  }, { passive: true });
})();
