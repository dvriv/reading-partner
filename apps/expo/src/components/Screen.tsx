import type { PropsWithChildren } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

export function Screen({ title, children }: PropsWithChildren<{ title: string }>) {
  return (
    <ScrollView contentContainerStyle={styles.container}>
      <View style={styles.panel}>
        <Text style={styles.title}>{title}</Text>
        {children}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flexGrow: 1,
    alignItems: 'center',
    padding: 16,
    backgroundColor: '#111827',
  },
  panel: {
    width: '100%',
    maxWidth: 920,
    gap: 14,
  },
  title: {
    color: '#f9fafb',
    fontSize: 30,
    fontWeight: '800',
    letterSpacing: -0.5,
  },
});
