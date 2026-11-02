/**
 * expo-router stand-in. Links and the router record where they would go; Stack and Tabs render
 * their headers and tab bar with fake navigation so layouts can be tested without a navigator.
 */
import { Children, cloneElement, isValidElement, type ReactElement, type ReactNode } from 'react';
import { Pressable, Text, View } from 'react-native';

export const router = {
  push: jest.fn(),
  replace: jest.fn(),
  back: jest.fn(),
  navigate: jest.fn(),
};

export const routeState = {
  params: {} as Record<string, string | undefined>,
  canGoBack: true,
  tabIndex: 0,
  /** Content a test puts inside each stack screen (the screens themselves are not rendered). */
  content: null as ((name: string) => ReactNode) | null,
};

export const tabNavigation = {
  emit: jest.fn((_event: { type: string; target: string; canPreventDefault: boolean }) => ({
    defaultPrevented: false,
  })),
  navigate: jest.fn(),
};

export function resetRouter(): void {
  for (const fn of Object.values(router)) fn.mockReset();
  tabNavigation.emit.mockClear();
  tabNavigation.navigate.mockReset();
  routeState.params = {};
  routeState.canGoBack = true;
  routeState.tabIndex = 0;
  routeState.content = null;
}

interface LinkProps {
  href: unknown;
  asChild?: boolean;
  children: ReactNode;
}

function Link({ href, asChild, children }: LinkProps) {
  const go = () => {
    router.push(href);
  };
  if (asChild && isValidElement<{ onPress?: () => void }>(children))
    return cloneElement(children, { onPress: go });
  return (
    <Pressable accessibilityRole="link" onPress={go}>
      <Text>{children}</Text>
    </Pressable>
  );
}

interface HeaderNavigation {
  canGoBack: () => boolean;
  goBack: () => void;
}
interface ScreenOptions {
  title?: string;
  headerShown?: boolean;
  header?: (props: { navigation: HeaderNavigation }) => ReactNode;
}
interface ScreenProps {
  name: string;
  options?: ScreenOptions;
}

function Stack({ children }: { children?: ReactNode; screenOptions?: unknown }) {
  return <View testID="stack">{children}</View>;
}
function StackScreen({ name, options }: ScreenProps) {
  const navigation = {
    canGoBack: () => routeState.canGoBack,
    goBack: () => {
      router.back();
    },
  };
  return (
    <View testID={`screen:${name}`}>
      {options?.header?.({ navigation })}
      {routeState.content?.(name)}
    </View>
  );
}
function StackProtected({ guard, children }: { guard: boolean; children: ReactNode }) {
  return guard ? <>{children}</> : null;
}
Stack.Screen = StackScreen;
Stack.Protected = StackProtected;

interface TabsProps {
  children: ReactNode;
  tabBar: (props: {
    state: { index: number; routes: { key: string; name: string }[] };
    descriptors: Record<string, { options: { title?: string } }>;
    navigation: typeof tabNavigation;
  }) => ReactNode;
  screenOptions: {
    header: (props: { options: { title?: string } }) => ReactNode;
    sceneStyle?: unknown;
  };
}

function Tabs({ children, tabBar, screenOptions }: TabsProps) {
  const screens = Children.toArray(children).filter(isValidElement) as ReactElement<{
    name: string;
    options?: { title?: string };
  }>[];
  const routes = screens.map((s) => ({ key: `${s.props.name}-key`, name: s.props.name }));
  const descriptors = Object.fromEntries(
    screens.map((s) => [`${s.props.name}-key`, { options: s.props.options ?? {} }]),
  );
  const focused = screens[routeState.tabIndex]?.props.options ?? {};
  return (
    <View testID="tabs">
      {screenOptions.header({ options: focused })}
      {tabBar({
        state: { index: routeState.tabIndex, routes },
        descriptors,
        navigation: tabNavigation,
      })}
    </View>
  );
}
Tabs.Screen = function TabsScreen(_props: ScreenProps) {
  return null;
};

export const expoRouterMock = {
  Link,
  Stack,
  Tabs,
  useRouter: () => router,
  useLocalSearchParams: () => routeState.params,
};
