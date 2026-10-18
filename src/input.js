// Keyboard, mouse and touch input. Uses physical key codes so it works on any layout.
export class Input {
  constructor(canvas) {
    this.down = new Set();
    this.pressed = [];          // one-shot key presses this frame
    this.dragDX = 0; this.dragDY = 0; this.wheel = 0; this.clicks = 0;
    this.mouseDown = false; this.moved = 0; this.downT = 0;
    this.enabled = true;
    const block = new Set(['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab', 'Backspace']);
    window.addEventListener('keydown', (e) => {
      if (e.target && (e.target.tagName === 'INPUT' && e.target.type !== 'range')) return;
      if (block.has(e.code)) e.preventDefault();
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (!this.down.has(e.code)) this.pressed.push(e.code === 'Tab' && e.shiftKey ? 'ShiftTab' : e.code); // Shift read now, not next frame
      this.down.add(e.code);
    });
    window.addEventListener('keyup', (e) => { this.down.delete(e.code); });
    window.addEventListener('blur', () => { this.down.clear(); this.mouseDown = false; });
    document.addEventListener('visibilitychange', () => { if (document.hidden) this.down.clear(); });
    canvas.addEventListener('pointerdown', (e) => {
      this.mouseDown = true; this.moved = 0; this.downT = performance.now();
      try { canvas.setPointerCapture(e.pointerId); } catch (_) { /* optional */ }
      canvas.focus();
    });
    canvas.addEventListener('pointermove', (e) => {
      if (!this.mouseDown) return;
      this.dragDX += e.movementX; this.dragDY += e.movementY;
      this.moved += Math.abs(e.movementX) + Math.abs(e.movementY);
    });
    const up = (e) => {
      if (!this.mouseDown) return;
      this.mouseDown = false;
      if (e.button === 0 && this.moved < 8 && performance.now() - this.downT < 450) this.clicks++;
    };
    canvas.addEventListener('pointerup', up);
    canvas.addEventListener('pointercancel', () => { this.mouseDown = false; });
    canvas.addEventListener('wheel', (e) => { e.preventDefault(); this.wheel += Math.sign(e.deltaY); }, { passive: false });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  }
  has(...codes) { return codes.some(c => this.down.has(c)); }
  take() { const p = this.pressed; this.pressed = []; return p; }
  consumeDrag() { const d = [this.dragDX, this.dragDY]; this.dragDX = 0; this.dragDY = 0; return d; }

  // build the vehicle control state
  controls() {
    return {
      throttle: this.has('KeyW', 'ArrowUp') ? 1 : 0,
      brake: this.has('KeyS', 'ArrowDown') ? 1 : 0,
      steer: (this.has('KeyA', 'ArrowLeft') ? 1 : 0) - (this.has('KeyD', 'ArrowRight') ? 1 : 0),
      handbrake: this.has('KeyX'),
      boost: this.has('ShiftLeft', 'ShiftRight'),
      lift: this.has('Space'),
      descend: this.has('KeyC'),
      roll: (this.has('KeyE') ? 1 : 0) - (this.has('KeyQ') ? 1 : 0),
      fire: this.has('KeyB'),
    };
  }

  // on-screen touch buttons (phones / tablets)
  buildTouch(root, onTap) {
    const L = 'max(16px, env(safe-area-inset-left))', R = 'max(16px, env(safe-area-inset-right))', B = 'calc(20px + env(safe-area-inset-bottom))';
    const at = (side, col, row) => `${side}: calc(${side === 'left' ? L : R} + ${col * 74}px); bottom: calc(${B} + ${row * 74}px);`;
    const btns = [
      ['◀', 'KeyA', at('left', 0, 0)], ['▶', 'KeyD', at('left', 1, 0)],
      ['CAM', 'tap:KeyV', at('left', 0, 1)], ['MENU', 'tap:KeyP', at('left', 1, 1)],
      ['BRAKE', 'KeyS', at('right', 0, 0)], ['GAS', 'KeyW', at('right', 1, 0)],
      ['DOWN', 'KeyC', at('right', 0, 1)], ['UP', 'Space', at('right', 1, 1)],
      ['FIRE', 'KeyB', at('right', 0, 2)], ['BOOST', 'ShiftLeft', at('right', 1, 2)],
    ];
    for (const [label, code, style] of btns) {
      const b = document.createElement('button');
      b.textContent = label; b.setAttribute('style', style); b.setAttribute('aria-label', label);
      if (code.startsWith('tap:')) {
        b.addEventListener('pointerdown', (e) => { e.preventDefault(); onTap(code.slice(4)); });
      } else {
        const on = (e) => { e.preventDefault(); this.down.add(code); b.classList.add('on'); };
        const off = (e) => { e.preventDefault(); this.down.delete(code); b.classList.remove('on'); };
        b.addEventListener('pointerdown', on); b.addEventListener('pointerup', off); b.addEventListener('pointercancel', off); b.addEventListener('pointerleave', off);
      }
      root.appendChild(b);
    }
  }
}
