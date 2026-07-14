import { useState } from 'react';
import * as DocumentPicker from 'expo-document-picker';
import { router } from 'expo-router';
import { BodyText, Button, Card, Input } from '../src/components/Controls';
import { Screen } from '../src/components/Screen';
import { apiFetch, logClient } from '../src/lib/api';

export default function UploadBook() {
  const [seriesId, setSeriesId] = useState('');
  const [bookNumber, setBookNumber] = useState('');
  const [message, setMessage] = useState('');
  return (
    <Screen title="Upload Book">
      <Card>
        <BodyText>Choose a DRM-free EPUB. The server extracts text, creates chunks, embeds with Voyage, and deletes the original upload.</BodyText>
        <Input placeholder="Optional series id" value={seriesId} onChangeText={setSeriesId} />
        <Input placeholder="Optional book number" keyboardType="numeric" value={bookNumber} onChangeText={setBookNumber} />
        <Button onPress={async () => {
          const picked = await DocumentPicker.getDocumentAsync({ type: ['application/epub+zip', 'application/octet-stream'], copyToCacheDirectory: true });
          if (picked.canceled) return;
          const asset = picked.assets[0];
          const form = new FormData();
          form.append('file', { uri: asset.uri, name: asset.name, type: asset.mimeType ?? 'application/epub+zip' } as unknown as Blob);
          if (seriesId) form.append('seriesId', seriesId);
          if (bookNumber) form.append('bookNumber', bookNumber);
          logClient('upload:start', { name: asset.name });
          const result = await apiFetch<{ bookId: string }>('/books/upload', { method: 'POST', body: form });
          logClient('upload:done', result);
          router.replace(`/book/${result.bookId}`);
        }}>Pick EPUB</Button>
        {message ? <BodyText>{message}</BodyText> : null}
      </Card>
    </Screen>
  );
}
