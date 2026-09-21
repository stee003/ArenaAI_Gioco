import { uid } from '../core/util';
import type { GameState, NewsItem, NewsKind } from './types';

/**
 * The world's event feed. Every system writes here; the Chronicle compiler and
 * the UI ticker read from here. News is the storytelling glue that turns raw
 * simulation state into a world the player can *hear about*.
 */

const MAX_NEWS = 260;

export function addNews(
  s: GameState,
  item: { kind: NewsKind; text: string; importance?: 1 | 2 | 3; cityId?: string; day?: number },
): NewsItem {
  const n: NewsItem = {
    id: uid('n'),
    day: item.day ?? s.day,
    kind: item.kind,
    text: item.text,
    importance: item.importance ?? 1,
    cityId: item.cityId,
  };
  s.news.push(n);
  if (s.news.length > MAX_NEWS) s.news.splice(0, s.news.length - MAX_NEWS);
  return n;
}

