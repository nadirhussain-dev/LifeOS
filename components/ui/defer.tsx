import { useEffect, useState, type ReactNode } from 'react';
import { InteractionManager, View } from 'react-native';

type Props = {
  children: ReactNode;
  /**
   * Held in the layout until `children` mount, so the scroll position and the
   * scrollbar don't jump as sections appear. Give it the height the real
   * content will occupy.
   */
  placeholderHeight?: number;
  placeholder?: ReactNode;
};

/**
 * Mounts its children after the first frame has been painted.
 *
 * The dashboard mounts eight widgets at once, each with its own query, plus
 * the hero's four — twelve requests and twelve component trees competing with
 * the first paint, when only the top two are on screen. Deferring the rest
 * lets the hero (the thing that answers "what should I do next?") render
 * first and the rest arrive a frame later.
 *
 * This defers, it does not virtualise: everything still mounts, just not all
 * at once, and nothing unmounts on scroll. That is the right trade here —
 * these sections are a screenful, not an unbounded list, and their queries are
 * cached, so a real windowing list would add complexity for a fixed set of
 * eight. Use `FlashList` when the count is unbounded (see the tasks and habits
 * screens); use this when it is small and the cost is startup, not scroll.
 */
export function Defer({ children, placeholderHeight, placeholder }: Props) {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    // Cancelled on unmount: without this, navigating away before interactions
    // settle sets state on a component that is gone.
    const handle = InteractionManager.runAfterInteractions(() => setReady(true));
    return () => handle.cancel();
  }, []);

  if (ready) return <>{children}</>;
  if (placeholder) return <>{placeholder}</>;
  return placeholderHeight ? <View style={{ height: placeholderHeight }} /> : null;
}
