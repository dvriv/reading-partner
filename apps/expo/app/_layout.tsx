import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';

export default function Layout() {
  return (
    <>
      <Stack screenOptions={{ headerStyle: { backgroundColor: '#111827' }, headerTintColor: '#f9fafb', contentStyle: { backgroundColor: '#111827' } }} />
      <StatusBar style="light" />
    </>
  );
}
