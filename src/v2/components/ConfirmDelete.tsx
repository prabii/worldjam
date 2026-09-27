import React, { useState } from 'react';
import { Text, View } from 'react-native';

import { font, space } from '../theme';
import { Button, Sheet } from './ui';

/** Destructive confirmation used everywhere something can be deleted. */
export function ConfirmDelete({
  visible,
  what,
  detail,
  onCancel,
  onConfirm,
}: {
  visible: boolean;
  what: string;
  detail?: string;
  onCancel: () => void;
  onConfirm: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <Sheet visible={visible} onClose={onCancel} title={`Delete ${what}?`}>
      <View style={{ gap: space.lg }}>
        <Text style={font.body}>{detail ?? 'This removes it from My Jams and deletes its files from this phone.'}</Text>
        <View style={{ flexDirection: 'row', gap: space.md }}>
          <Button label="Cancel" onPress={onCancel} style={{ flex: 1 }} />
          <Button
            label="Delete"
            kind="danger"
            icon="delete"
            busy={busy}
            style={{ flex: 1 }}
            onPress={async () => {
              setBusy(true);
              try {
                await onConfirm();
              } finally {
                setBusy(false);
              }
            }}
          />
        </View>
      </View>
    </Sheet>
  );
}
