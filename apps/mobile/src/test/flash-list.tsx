/**
 * FlashList stand-in: a FlatList with the same props (FlashList 2.0.2's own jestSetup points at an
 * export that no longer exists). Items render without native measurement; getItemType is still
 * asked for every item, as FlashList does.
 */
import { FlatList, type FlatListProps } from 'react-native';

type Props<T> = FlatListProps<T> & { getItemType?: (item: T, index: number) => string };

export function FlashList<T>({ getItemType, ...props }: Props<T>) {
  const data = (props.data ?? []) as readonly T[];
  data.forEach((item, i) => getItemType?.(item, i));
  return <FlatList {...props} initialNumToRender={data.length} />;
}
