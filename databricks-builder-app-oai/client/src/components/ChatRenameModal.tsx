import { useEffect, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Dialog } from './ui/Dialog';
import { Input } from './ui/Input';
import { Button } from './ui/Button';

interface ChatRenameModalProps {
  isOpen: boolean;
  initialTitle: string;
  onClose: () => void;
  onSave: (title: string) => Promise<void>;
}

export function ChatRenameModal({
  isOpen,
  initialTitle,
  onClose,
  onSave,
}: ChatRenameModalProps) {
  const [title, setTitle] = useState(initialTitle);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
      setTitle(initialTitle);
      setIsSubmitting(false);
      setTimeout(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      }, 100);
    }
  }, [isOpen, initialTitle]);

  const handleSubmit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    const trimmed = title.trim();
    if (!trimmed || trimmed === initialTitle || isSubmitting) return;

    setIsSubmitting(true);
    try {
      await onSave(trimmed);
      onClose();
    } catch (error) {
      console.error('Failed to rename chat:', error);
    } finally {
      setIsSubmitting(false);
    }
  };

  const trimmed = title.trim();
  const canSave = !!trimmed && trimmed !== initialTitle && !isSubmitting;

  return (
    <Dialog
      isOpen={isOpen}
      onClose={onClose}
      title="Rename Chat"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button
            onClick={() => handleSubmit()}
            disabled={!canSave}
            className="min-w-[100px]"
          >
            {isSubmitting ? (
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
            ) : null}
            Save
          </Button>
        </>
      }
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-2">
          <label className="text-xs font-semibold text-[var(--color-text-muted)] uppercase tracking-wider">
            Chat Title
          </label>
          <Input
            ref={inputRef}
            placeholder="e.g. Q3 revenue investigation"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            disabled={isSubmitting}
            maxLength={255}
          />
        </div>
      </form>
    </Dialog>
  );
}
