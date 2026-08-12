import { useEffect, useRef, useState } from 'react';

// The real backend progress signal arrives in coarse, uneven jumps (a
// handful of batched network calls for phase 1, then individual per-match
// completions for phase 2) and is only polled every 600ms — left alone, the
// displayed percentage looks like it teleports from 0% to ~50% and then
// sits still. This smooths it into a continuous crawl: it eases toward the
// real target, and when the real signal hasn't moved yet it keeps creeping
// forward anyway (capped short of 100%) so the bar never visibly freezes.
export default function useSmoothProgress(targetPct, active) {
  var [display, setDisplay] = useState(0);
  var displayRef = useRef(0);
  var targetRef = useRef(0);

  useEffect(
    function () {
      targetRef.current = targetPct;
    },
    [targetPct]
  );

  useEffect(
    function () {
      if (!active) {
        displayRef.current = 0;
        setDisplay(0);
        return;
      }
      var interval = setInterval(function () {
        var current = displayRef.current;
        var target = targetRef.current;
        var next;
        if (current < target) {
          next = current + Math.max((target - current) * 0.22, 0.6);
        } else {
          // Real signal hasn't advanced yet — keep a slow crawl alive rather
          // than let the bar sit frozen, but never fake all the way to 100%.
          next = current + 0.35;
        }
        next = Math.min(next, 99);
        displayRef.current = next;
        setDisplay(next);
      }, 120);
      return function () {
        clearInterval(interval);
      };
    },
    [active]
  );

  return Math.round(display);
}
