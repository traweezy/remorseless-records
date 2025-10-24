# WEB ANIMATION GUIDE - REMORSELESS STORE

## Table of Contents
1. [Cart Sidebar Animation Issues & Solutions](#cart-sidebar-animation-issues--solutions)
2. [Animation Principles](#animation-principles)
3. [Performance Optimization](#performance-optimization)
4. [Implementation Guide](#implementation-guide)
5. [Accessibility](#accessibility)
6. [Component-Specific Guidelines](#component-specific-guidelines)

---

## CART SIDEBAR ANIMATION ISSUES & SOLUTIONS

### Current Problems
The cart sidebar currently has poor animation quality due to:
- Abrupt transitions without proper easing
- No stagger effect on cart items
- Overlay fades too quickly
- Exit animations are jarring
- No spring physics for natural motion

### Recommended Animation Specifications

#### 1. Sidebar Slide-In Animation
```typescript
// CORRECT: Smooth slide with spring physics
initial={{ x: "100%" }}
animate={{ x: 0 }}
exit={{ x: "100%" }}
transition={{
  type: "spring",
  damping: 30,
  stiffness: 300,
  mass: 0.8
}}
```

**Timing:** 350-450ms (feels natural, not too fast)  
**Easing:** Spring physics with moderate damping  
**Why:** Spring animations feel more natural than linear easing. Damping prevents bouncing.

#### 2. Overlay Fade Animation
```typescript
// CORRECT: Gentle fade with slight delay
initial={{ opacity: 0 }}
animate={{ opacity: 1 }}
exit={{ opacity: 0 }}
transition={{
  duration: 0.3,
  ease: [0.4, 0, 0.2, 1] // cubic-bezier easing
}}
```

**Timing:** 300ms  
**Easing:** Custom cubic-bezier for smooth acceleration  
**Why:** Overlay should fade slightly slower than content slides in

#### 3. Cart Items Stagger Animation
```typescript
// CORRECT: Stagger children for polished feel
<motion.div
  initial="hidden"
  animate="visible"
  variants={{
    visible: {
      transition: {
        staggerChildren: 0.05,
        delayChildren: 0.1
      }
    }
  }}
>
  {cartItems.map((item) => (
    <motion.div
      key={item.id}
      variants={{
        hidden: { opacity: 0, x: 20 },
        visible: { opacity: 1, x: 0 }
      }}
      transition={{
        duration: 0.3,
        ease: [0.4, 0, 0.2, 1]
      }}
    >
      {/* Cart item content */}
    </motion.div>
  ))}
</motion.div>
```

**Stagger Delay:** 50ms between items  
**Initial Delay:** 100ms after sidebar opens  
**Why:** Creates hierarchy and draws eye down the list naturally

#### 4. CTA Button Animation
```typescript
// CORRECT: Subtle scale on hover, spring on tap
<motion.button
  whileHover={{ scale: 1.02 }}
  whileTap={{ scale: 0.98 }}
  transition={{
    type: "spring",
    stiffness: 400,
    damping: 17
  }}
>
  Proceed to Checkout
</motion.button>
```

**Hover Scale:** 2% increase  
**Tap Scale:** 2% decrease  
**Why:** Provides tactile feedback without being distracting

### Complete Cart Sidebar Implementation

```typescript
// src/components/CartDrawer.tsx

import { motion, AnimatePresence } from "framer-motion";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useCart } from "@/contexts/CartContext";
import { Button } from "@/components/ui/button";
import { X } from "lucide-react";

interface CartDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export const CartDrawer = ({ open, onOpenChange }: CartDrawerProps) => {
  const { items, total } = useCart();

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent 
        side="right" 
        className="w-full sm:max-w-lg overflow-hidden p-0"
        asChild
      >
        <motion.div
          initial={{ x: "100%" }}
          animate={{ x: 0 }}
          exit={{ x: "100%" }}
          transition={{
            type: "spring",
            damping: 30,
            stiffness: 300,
            mass: 0.8
          }}
        >
          {/* Header - No animation, stays fixed */}
          <SheetHeader className="px-6 py-4 border-b sticky top-0 bg-background z-10">
            <div className="flex items-center justify-between">
              <SheetTitle className="text-2xl font-bebas tracking-wider">
                Your Cart ({items.length})
              </SheetTitle>
              <Button 
                variant="ghost" 
                size="icon"
                onClick={() => onOpenChange(false)}
                className="hover:bg-accent"
              >
                <X className="h-5 w-5" />
              </Button>
            </div>
          </SheetHeader>

          {/* Cart Items - Staggered animation */}
          <motion.div 
            className="flex-1 overflow-y-auto px-6 py-4"
            initial="hidden"
            animate="visible"
            variants={{
              visible: {
                transition: {
                  staggerChildren: 0.05,
                  delayChildren: 0.1
                }
              }
            }}
          >
            {items.length === 0 ? (
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.3 }}
                className="text-center py-12"
              >
                <p className="text-muted-foreground mb-4">Your cart is empty</p>
                <Button 
                  variant="outline" 
                  onClick={() => onOpenChange(false)}
                >
                  Continue Shopping
                </Button>
              </motion.div>
            ) : (
              <div className="space-y-4">
                {items.map((item) => (
                  <motion.div
                    key={item.id}
                    variants={{
                      hidden: { opacity: 0, x: 20 },
                      visible: { opacity: 1, x: 0 }
                    }}
                    transition={{
                      duration: 0.3,
                      ease: [0.4, 0, 0.2, 1]
                    }}
                    layout // Enables layout animations when items are removed
                  >
                    {/* Cart item content */}
                  </motion.div>
                ))}
              </div>
            )}
          </motion.div>

          {/* Footer CTA - Slides up slightly */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ 
              duration: 0.3,
              delay: 0.2,
              ease: [0.4, 0, 0.2, 1]
            }}
            className="border-t px-6 py-4 bg-background sticky bottom-0"
          >
            <div className="space-y-4">
              {/* Subtotal */}
              <div className="flex items-center justify-between text-lg">
                <span className="font-medium">Subtotal:</span>
                <span className="font-bebas text-2xl">${total.toFixed(2)}</span>
              </div>

              {/* Checkout Button with hover/tap animations */}
              <motion.div
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                transition={{
                  type: "spring",
                  stiffness: 400,
                  damping: 17
                }}
              >
                <Button 
                  className="w-full h-12 text-base"
                  onClick={() => {
                    onOpenChange(false);
                    // Navigate to checkout
                  }}
                >
                  Proceed to Checkout
                </Button>
              </motion.div>

              {/* Continue Shopping Link */}
              <motion.button
                whileHover={{ x: 2 }}
                transition={{ duration: 0.2 }}
                className="w-full text-center text-sm text-muted-foreground hover:text-foreground transition-colors"
                onClick={() => onOpenChange(false)}
              >
                Continue Shopping
              </motion.button>
            </div>
          </motion.div>
        </motion.div>
      </SheetContent>
    </Sheet>
  );
};
```

---

## ANIMATION PRINCIPLES

### The 12 Disney Principles (Applied to Web)

#### 1. **Timing** - Duration Control
```typescript
// ❌ WRONG: Too fast (jarring)
transition={{ duration: 0.1 }}

// ❌ WRONG: Too slow (boring)
transition={{ duration: 1.5 }}

// ✅ CORRECT: Sweet spot for UI
transition={{ duration: 0.3 }}
```

**Recommended Durations:**
- Micro-interactions (hover, tap): **100-200ms**
- Component transitions (modals, drawers): **250-400ms**
- Page transitions: **300-500ms**
- Complex animations: **400-600ms**
- Never exceed **800ms** for UI animations

#### 2. **Easing** - Natural Motion
```typescript
// ❌ WRONG: Linear motion (robotic)
transition={{ ease: "linear" }}

// ✅ CORRECT: Natural deceleration
transition={{ ease: [0.4, 0, 0.2, 1] }} // cubic-bezier

// ✅ CORRECT: Spring physics (best for interactions)
transition={{ 
  type: "spring",
  damping: 25,
  stiffness: 300 
}}
```

**Recommended Easing Functions:**
- **Ease-out** `[0.0, 0.0, 0.2, 1]`: Elements entering screen
- **Ease-in** `[0.4, 0.0, 1, 1]`: Elements leaving screen
- **Ease-in-out** `[0.4, 0.0, 0.2, 1]`: Elements moving on screen
- **Spring**: Interactive elements (buttons, toggles)

#### 3. **Staging** - Clear Focal Point
```typescript
// ✅ CORRECT: Guide user attention with stagger
<motion.div
  variants={{
    visible: {
      transition: {
        staggerChildren: 0.1 // One element at a time
      }
    }
  }}
>
  {/* Children animate in sequence */}
</motion.div>
```

#### 4. **Follow Through** - Realistic Physics
```typescript
// ✅ CORRECT: Spring with overshoot
transition={{
  type: "spring",
  damping: 15, // Lower = more bounce
  stiffness: 300
}}
```

### Performance Principles

#### ONLY Animate These Properties (GPU Accelerated):
1. **transform** (translate, scale, rotate)
2. **opacity**
3. **filter** (use sparingly)

```typescript
// ✅ CORRECT: Smooth 60fps animation
<motion.div
  animate={{ 
    x: 100,        // transform: translateX
    scale: 1.5,    // transform: scale
    opacity: 0.5   // opacity
  }}
/>

// ❌ WRONG: Causes reflow/repaint (janky)
<motion.div
  animate={{ 
    width: "300px",   // ❌ Forces reflow
    height: "200px",  // ❌ Forces reflow
    top: "50px",      // ❌ Forces reflow
    left: "100px",    // ❌ Forces reflow
    margin: "20px",   // ❌ Forces reflow
    padding: "10px",  // ❌ Forces reflow
    backgroundColor: "#ff0000" // ❌ Repaint
  }}
/>
```

#### will-change Property (Use Sparingly!)
```css
/* ✅ CORRECT: Only on elements about to animate */
.sidebar-entering {
  will-change: transform, opacity;
}

/* ❌ WRONG: Always applied (wastes GPU memory) */
.sidebar {
  will-change: transform, opacity;
}
```

```typescript
// ✅ CORRECT: Add will-change only during animation
<motion.div
  onAnimationStart={() => {
    element.style.willChange = "transform, opacity";
  }}
  onAnimationComplete={() => {
    element.style.willChange = "auto";
  }}
/>
```

---

## PERFORMANCE OPTIMIZATION

### Frame Rate Target: 60fps (16.67ms per frame)

#### Monitor Performance
```typescript
// Add to development environment
<motion.div
  onUpdate={(latest) => {
    console.log(latest); // Monitor animation values
  }}
  onAnimationStart={() => {
    performance.mark("animation-start");
  }}
  onAnimationComplete={() => {
    performance.mark("animation-end");
    performance.measure("animation-duration", "animation-start", "animation-end");
    const measure = performance.getEntriesByName("animation-duration")[0];
    console.log(`Animation took ${measure.duration}ms`);
  }}
/>
```

### GPU Acceleration Techniques

#### Force GPU Layer
```css
/* Promote element to its own GPU layer */
.accelerated {
  transform: translateZ(0); /* or translate3d(0,0,0) */
  backface-visibility: hidden;
}
```

#### Contain Paint & Layout
```css
/* Prevent expensive reflows */
.animated-container {
  contain: layout paint;
}
```

### Reduce Animation Complexity

```typescript
// ❌ WRONG: Animating many elements individually
{items.map((item) => (
  <motion.div 
    key={item.id}
    animate={{ opacity: 1, y: 0, scale: 1, rotate: 0 }}
  />
))}

// ✅ CORRECT: Batch similar animations
<motion.div
  initial="hidden"
  animate="visible"
  variants={{
    visible: { 
      transition: { staggerChildren: 0.05 }
    }
  }}
>
  {items.map((item) => (
    <motion.div 
      key={item.id}
      variants={itemVariants} // Reuse variants
    />
  ))}
</motion.div>
```

### Reduce Animation During Scroll

```typescript
// Disable expensive animations during scroll
const [isScrolling, setIsScrolling] = useState(false);

useEffect(() => {
  let timeout: NodeJS.Timeout;
  
  const handleScroll = () => {
    setIsScrolling(true);
    clearTimeout(timeout);
    timeout = setTimeout(() => setIsScrolling(false), 150);
  };
  
  window.addEventListener("scroll", handleScroll);
  return () => window.removeEventListener("scroll", handleScroll);
}, []);

// Use in animations
<motion.div
  animate={{ opacity: isScrolling ? 1 : 0.5 }}
  transition={{ duration: isScrolling ? 0 : 0.3 }}
/>
```

---

## IMPLEMENTATION GUIDE

### 1. Animation Variants Pattern (Recommended)

```typescript
// Define reusable animation variants
const fadeInUp = {
  hidden: { opacity: 0, y: 20 },
  visible: { 
    opacity: 1, 
    y: 0,
    transition: {
      duration: 0.3,
      ease: [0.4, 0, 0.2, 1]
    }
  }
};

const staggerContainer = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren: 0.1,
      delayChildren: 0.2
    }
  }
};

// Use in components
<motion.div
  initial="hidden"
  animate="visible"
  variants={fadeInUp}
>
  Content
</motion.div>
```

### 2. Create Animation Library

```typescript
// src/lib/animations.ts

export const animations = {
  // Fade animations
  fadeIn: {
    hidden: { opacity: 0 },
    visible: { opacity: 1 }
  },
  fadeInUp: {
    hidden: { opacity: 0, y: 20 },
    visible: { opacity: 1, y: 0 }
  },
  fadeInDown: {
    hidden: { opacity: 0, y: -20 },
    visible: { opacity: 1, y: 0 }
  },

  // Scale animations
  scaleIn: {
    hidden: { opacity: 0, scale: 0.9 },
    visible: { opacity: 1, scale: 1 }
  },

  // Slide animations
  slideInRight: {
    hidden: { x: "100%" },
    visible: { x: 0 }
  },
  slideInLeft: {
    hidden: { x: "-100%" },
    visible: { x: 0 }
  },

  // Container animations
  staggerContainer: {
    hidden: { opacity: 0 },
    visible: {
      opacity: 1,
      transition: {
        staggerChildren: 0.1
      }
    }
  }
};

export const transitions = {
  // Ease presets
  smooth: {
    duration: 0.3,
    ease: [0.4, 0, 0.2, 1]
  },
  
  // Spring presets
  springBouncy: {
    type: "spring",
    damping: 15,
    stiffness: 300
  },
  springSmooth: {
    type: "spring",
    damping: 30,
    stiffness: 300
  },
  springSnappy: {
    type: "spring",
    damping: 25,
    stiffness: 400
  }
};
```

### 3. Page Transition Setup

```typescript
// src/components/PageTransition.tsx
import { motion } from "framer-motion";
import { ReactNode } from "react";

interface PageTransitionProps {
  children: ReactNode;
}

const pageVariants = {
  initial: {
    opacity: 0,
    y: 20
  },
  animate: {
    opacity: 1,
    y: 0,
    transition: {
      duration: 0.4,
      ease: [0.4, 0, 0.2, 1]
    }
  },
  exit: {
    opacity: 0,
    y: -20,
    transition: {
      duration: 0.3,
      ease: [0.4, 0, 1, 1]
    }
  }
};

export const PageTransition = ({ children }: PageTransitionProps) => {
  return (
    <motion.div
      initial="initial"
      animate="animate"
      exit="exit"
      variants={pageVariants}
    >
      {children}
    </motion.div>
  );
};
```

### 4. Wrap Routes in AnimatePresence

```typescript
// src/App.tsx
import { AnimatePresence } from "framer-motion";
import { useLocation } from "react-router-dom";

function App() {
  const location = useLocation();
  
  return (
    <AnimatePresence mode="wait">
      <Routes location={location} key={location.pathname}>
        <Route path="/" element={
          <PageTransition>
            <Home />
          </PageTransition>
        } />
        {/* Other routes */}
      </Routes>
    </AnimatePresence>
  );
}
```

---

## ACCESSIBILITY

### Respect User Preferences

```typescript
// Hook to detect reduced motion preference
import { useReducedMotion } from "framer-motion";

export const AccessibleAnimation = () => {
  const shouldReduceMotion = useReducedMotion();

  return (
    <motion.div
      animate={{ 
        opacity: 1,
        x: shouldReduceMotion ? 0 : 100 // Disable x animation if reduced motion
      }}
      transition={{ 
        duration: shouldReduceMotion ? 0 : 0.3 // Instant if reduced motion
      }}
    >
      Content
    </motion.div>
  );
};
```

### Media Query Approach
```css
/* Disable animations for users who prefer reduced motion */
@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
  }
}
```

### Guidelines
1. **Never animate critical content** - Information should be readable even if animations fail
2. **Provide alternatives** - Instant transitions for reduced motion users
3. **Avoid flashing** - No animations faster than 3 flashes per second (epilepsy risk)
4. **Don't rely on motion** - Use color, text, or icons as backup indicators

---

## COMPONENT-SPECIFIC GUIDELINES

### Navigation Menu

```typescript
// Dropdown menu animation
const dropdownVariants = {
  hidden: { 
    opacity: 0, 
    scale: 0.95,
    y: -10
  },
  visible: { 
    opacity: 1, 
    scale: 1,
    y: 0,
    transition: {
      duration: 0.2,
      ease: [0.4, 0, 0.2, 1]
    }
  },
  exit: {
    opacity: 0,
    scale: 0.95,
    y: -10,
    transition: {
      duration: 0.15,
      ease: [0.4, 0, 1, 1]
    }
  }
};
```

**Duration:** 200ms enter, 150ms exit  
**Why:** Menus should appear quickly, disappear slightly faster

### Product Cards

```typescript
// Hover effect
<motion.div
  whileHover={{ 
    y: -4,
    transition: { 
      duration: 0.2,
      ease: [0.4, 0, 0.2, 1]
    }
  }}
  className="product-card"
>
  <motion.img
    whileHover={{ scale: 1.05 }}
    transition={{ duration: 0.3 }}
  />
</motion.div>
```

**Card Lift:** 4px up  
**Image Scale:** 5% increase  
**Duration:** 200-300ms

### Modal/Dialog

```typescript
const modalVariants = {
  hidden: { 
    opacity: 0,
    scale: 0.9,
    y: 20
  },
  visible: { 
    opacity: 1,
    scale: 1,
    y: 0,
    transition: {
      duration: 0.3,
      ease: [0.4, 0, 0.2, 1]
    }
  }
};

const overlayVariants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1 }
};
```

**Modal:** Fade + scale + slight upward movement  
**Overlay:** Simple fade  
**Duration:** 300ms

### Toast Notifications

```typescript
const toastVariants = {
  hidden: { 
    opacity: 0,
    x: 100,
    scale: 0.9
  },
  visible: { 
    opacity: 1,
    x: 0,
    scale: 1,
    transition: {
      type: "spring",
      damping: 20,
      stiffness: 300
    }
  },
  exit: {
    opacity: 0,
    x: 100,
    transition: {
      duration: 0.2
    }
  }
};
```

**Enter:** Spring from right with slight scale  
**Exit:** Quick slide out right  
**Why:** Spring feels more playful for success messages

### Loading Spinners

```typescript
// Smooth continuous rotation
<motion.div
  animate={{ rotate: 360 }}
  transition={{
    duration: 1,
    repeat: Infinity,
    ease: "linear" // Linear is OK for spinners
  }}
>
  <Loader />
</motion.div>
```

**Duration:** 1 second per rotation  
**Easing:** Linear (exception to the rule)

### Skeleton Loaders

```typescript
// Shimmer effect
<motion.div
  animate={{
    backgroundPosition: ["200% 0", "-200% 0"]
  }}
  transition={{
    duration: 2,
    repeat: Infinity,
    ease: "linear"
  }}
  style={{
    background: "linear-gradient(90deg, hsl(var(--muted)) 0%, hsl(var(--muted-foreground) / 0.1) 50%, hsl(var(--muted)) 100%)",
    backgroundSize: "200% 100%"
  }}
/>
```

---

## TESTING ANIMATIONS

### Visual Testing Checklist
- [ ] Animations run at 60fps (use Chrome DevTools Performance tab)
- [ ] No janky or stuttering motion
- [ ] Easing feels natural, not linear or too bouncy
- [ ] Timing is appropriate (not too fast/slow)
- [ ] Multiple animations don't conflict
- [ ] Works on mobile devices (lower-powered)
- [ ] Respects `prefers-reduced-motion`
- [ ] Animations complete before user can interact

### Chrome DevTools
1. Open DevTools → Performance tab
2. Start recording
3. Trigger animation
4. Stop recording
5. Look for dropped frames (red bars)
6. Check FPS meter stays at 60fps

### Lighthouse Audit
- Run Lighthouse performance audit
- Check for "Avoid large layout shifts"
- Check for "Minimize main thread work"

---

## QUICK REFERENCE

### Animation Duration Guide
| Element Type | Duration | Easing |
|-------------|----------|--------|
| Micro-interaction (hover) | 100-200ms | ease-out |
| Button press | 100ms | spring |
| Dropdown menu | 200ms | ease-out |
| Modal/Dialog | 300ms | ease-in-out |
| Sidebar/Drawer | 350-450ms | spring |
| Page transition | 300-500ms | ease-in-out |
| Toast notification | 250ms | spring |

### Easing Functions
```typescript
// Standard easing (use these 90% of the time)
const easing = {
  easeOut: [0.0, 0.0, 0.2, 1],      // Elements entering
  easeIn: [0.4, 0.0, 1, 1],         // Elements exiting
  easeInOut: [0.4, 0.0, 0.2, 1],    // Elements moving
  sharp: [0.4, 0.0, 0.6, 1]         // Quick transitions
};

// Spring physics (use for interactive elements)
const spring = {
  smooth: { damping: 30, stiffness: 300 },
  bouncy: { damping: 15, stiffness: 300 },
  snappy: { damping: 25, stiffness: 400 }
};
```

### Common Mistakes to Avoid
1. ❌ Animating width, height, top, left, margin, padding
2. ❌ Using `will-change` on every element
3. ❌ Linear easing on UI animations
4. ❌ Animation durations over 800ms
5. ❌ Animating many elements simultaneously without stagger
6. ❌ Not respecting `prefers-reduced-motion`
7. ❌ Animating before content is loaded
8. ❌ Using animations on every single interaction

---

## RESOURCES

- **MDN CSS Animations Guide:** https://developer.mozilla.org/en-US/docs/Web/CSS/CSS_animations/Using_CSS_animations
- **web.dev Performance Guide:** https://web.dev/articles/animations-guide
- **Framer Motion Docs:** https://www.framer.com/motion/
- **CSS Animation Rocks:** https://cssanimation.rocks/
- **Material Motion Guidelines:** https://m3.material.io/styles/motion/overview

---

## SUMMARY

### For Cart Sidebar Specifically:
1. Use spring physics for slide-in: `damping: 30, stiffness: 300`
2. Stagger cart items by 50ms
3. Add subtle hover/tap effects to checkout button
4. Ensure smooth 60fps animation
5. Keep total animation under 450ms

### General Best Practices:
1. Only animate `transform` and `opacity`
2. Use durations between 200-400ms for most UI
3. Apply proper easing (avoid linear)
4. Respect `prefers-reduced-motion`
5. Test on lower-powered devices
6. Monitor performance with DevTools
7. Create reusable animation variants
8. Keep animations purposeful, not decorative

**Remember:** Good animation is invisible. Users should feel the improvement in UX without consciously noticing the animations themselves.
