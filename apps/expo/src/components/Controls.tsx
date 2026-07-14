import type { PropsWithChildren } from 'react';
import { Pressable, StyleSheet, Text, TextInput, type TextInputProps, View } from 'react-native';

export function Button({ children, onPress }: PropsWithChildren<{ onPress?: () => void }>) {
  return (
    <Pressable onPress={onPress} style={styles.button}>
      <Text style={styles.buttonText}>{children}</Text>
    </Pressable>
  );
}

export function Input(props: TextInputProps) {
  return <TextInput placeholderTextColor="#9ca3af" {...props} style={[styles.input, props.style]} />;
}

export function Card({ children }: PropsWithChildren) {
  return <View style={styles.card}>{children}</View>;
}

export function BodyText({ children }: PropsWithChildren) {
  return <Text style={styles.body}>{children}</Text>;
}

const styles = StyleSheet.create({
  button: {
    backgroundColor: '#a7f3d0',
    borderRadius: 16,
    paddingHorizontal: 18,
    paddingVertical: 13,
    alignItems: 'center',
  },
  buttonText: { color: '#052e16', fontWeight: '800' },
  input: {
    borderWidth: 1,
    borderColor: '#374151',
    borderRadius: 14,
    padding: 13,
    color: '#f9fafb',
    backgroundColor: '#1f2937',
  },
  card: {
    backgroundColor: '#1f2937',
    borderRadius: 20,
    padding: 16,
    gap: 10,
    borderWidth: 1,
    borderColor: '#374151',
  },
  body: { color: '#d1d5db', fontSize: 16, lineHeight: 23 },
});
