import { ArrowLeft, ArrowRight, ChevronLeft, ChevronRight } from '@/components/ui/icons';
import { I18nManager } from 'react-native';

/**
 * Icons whose glyph has to mirror in RTL. React Native flips layout but never
 * icon *content*, so a lucide `ChevronLeft` keeps pointing left in Arabic and a
 * back button ends up aimed at the content it came from.
 *
 * Resolved once at module scope — a direction change restarts the app, so these
 * can't go stale mid-session.
 *
 * Deliberately excluded: media transport controls (play, skip forward/back).
 * Those follow the tape, not the script, and stay left-to-right in every locale
 * on both iOS and Android.
 */
export const ChevronBack = I18nManager.isRTL ? ChevronRight : ChevronLeft;
export const ChevronForward = I18nManager.isRTL ? ChevronLeft : ChevronRight;
export const ArrowBack = I18nManager.isRTL ? ArrowRight : ArrowLeft;
export const ArrowForward = I18nManager.isRTL ? ArrowLeft : ArrowRight;
