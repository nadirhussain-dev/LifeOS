import { useModuleFlagsStore } from '@/features/module-flags/store/module-flags-store';
import { usePrivateStore } from '@/features/private/store/private-store';
import {
  MODULE_FOR_CATEGORY,
  categoryVisibility,
  moduleMayBeNamed,
  resolveNotificationContent,
} from '@/features/notifications/services/notification-visibility';
import {
  CATEGORY_ORDER,
  type NotificationCategory,
} from '@/features/notifications/types/notification.types';

/**
 * A reminder is the one part of this app that renders outside it, on a surface
 * the owner does not control and may not be holding. These tests hold the rule
 * that makes the privacy switches mean anything there: a hidden module's content
 * never reaches a notification's text.
 */

const REAL = { title: 'Rent is due tomorrow', body: '£1,450 to Anna' };

beforeEach(() => {
  useModuleFlagsStore.setState({ flags: {}, fetchedAt: null });
  usePrivateStore.setState({ privatised: [], key: null });
});

describe('category → module map', () => {
  it('covers every category', () => {
    // A category missing from the map would silently fall through to 'ok' and
    // be exempt from both switches — the failure is invisible until somebody's
    // lock screen shows something it should not.
    const unmapped = CATEGORY_ORDER.filter((category) => !(category in MODULE_FOR_CATEGORY));
    expect(unmapped).toEqual([]);
  });

  it('leaves only the digest unowned', () => {
    const unowned = (Object.keys(MODULE_FOR_CATEGORY) as NotificationCategory[]).filter(
      (category) => MODULE_FOR_CATEGORY[category] === null,
    );
    // The digest names several modules in one sentence, so it is filtered line
    // by line in digest.ts instead. Anything else appearing here is a category
    // that has quietly opted out of both switches.
    expect(unowned).toEqual(['digest']);
  });
});

describe('a privatised module', () => {
  it('still fires, but says nothing', () => {
    usePrivateStore.setState({ privatised: ['budget'] });
    expect(categoryVisibility('budget')).toBe('redacted');

    const resolved = resolveNotificationContent('budget', REAL);
    // Not null: dropping the reminder would punish the user for using a privacy
    // feature. They still want the nudge, just not a legible one.
    expect(resolved).not.toBeNull();
    expect(resolved).not.toEqual(REAL);
    expect(`${resolved?.title} ${resolved?.body}`).not.toMatch(/rent|1,450|anna/i);
  });

  it('is redacted even while the vault is unlocked', () => {
    // The lock state that matters is the one at fire time, tomorrow morning,
    // which is unknowable when the notification is scheduled today.
    usePrivateStore.setState({ privatised: ['budget'], key: new Uint8Array([1, 2, 3]) });
    expect(categoryVisibility('budget')).toBe('redacted');
  });

  it('names nothing that could identify the feature itself', () => {
    usePrivateStore.setState({ privatised: ['budget'] });
    const resolved = resolveNotificationContent('budget', REAL);
    // "A reminder from your private space" tells an observer this phone has a
    // private space and that there is something in it, which is most of what
    // they wanted to know.
    expect(`${resolved?.title} ${resolved?.body}`).not.toMatch(/private|vault|hidden|secret/i);
  });

  it('takes its module out of anything that names modules', () => {
    usePrivateStore.setState({ privatised: ['water'] });
    expect(moduleMayBeNamed('water')).toBe(false);
    expect(moduleMayBeNamed('tasks')).toBe(true);
  });
});

describe('an operator-disabled module', () => {
  it('is suppressed rather than redacted', () => {
    // Different problem, different answer: the module is withdrawn or broken,
    // so a nudge towards a screen the guard redirects away from is noise.
    useModuleFlagsStore.setState({ flags: { budget: { enabled: false, message: null } } });
    expect(categoryVisibility('budget')).toBe('suppressed');
    expect(resolveNotificationContent('budget', REAL)).toBeNull();
  });

  it('wins over the private switch', () => {
    // Order matters and matches useModuleAccess: a module pulled because it
    // corrupts data must not become reachable by unlocking the vault.
    useModuleFlagsStore.setState({ flags: { budget: { enabled: false, message: null } } });
    usePrivateStore.setState({ privatised: ['budget'] });
    expect(categoryVisibility('budget')).toBe('suppressed');
  });
});

describe('the default', () => {
  it('says everything, so a network blip cannot silence the app', () => {
    // Mirrors the fail-open rule in module-flags-store: no flag means enabled.
    for (const category of CATEGORY_ORDER) {
      expect(categoryVisibility(category)).toBe('ok');
    }
    expect(resolveNotificationContent('budget', REAL)).toEqual(REAL);
  });

  it('leaves untagged notifications alone', () => {
    // Test notifications and the focus-block summary carry no category. They are
    // messages about the app, not about any module's content.
    usePrivateStore.setState({ privatised: ['budget'] });
    expect(resolveNotificationContent(undefined, REAL)).toEqual(REAL);
  });
});
