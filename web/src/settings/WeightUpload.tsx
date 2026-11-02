import { useRef, useState } from "react";

export function WeightUpload({
  disabled,
  uploading,
  upload,
}: {
  disabled: boolean;
  uploading: boolean;
  upload: (file: File) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  return (
    <>
      <button
        type="button"
        className="weight-upload"
        disabled={disabled || uploading}
        data-dragging={dragging || undefined}
        onClick={() => input.current?.click()}
        onDragOver={(event) => {
          event.preventDefault();

          if (!disabled && !uploading) {
            setDragging(true);
          }
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          const file = event.dataTransfer.files[0];

          if (file && !disabled && !uploading) {
            upload(file);
          }
        }}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M12 16V3m-5 5 5-5 5 5M4 15v5h16v-5" />
        </svg>
        <span>
          {uploading ? "Validating weights…" : "Upload weights"}
          <small>NPZ, up to 64 MB</small>
        </span>
      </button>
      <input
        ref={input}
        type="file"
        hidden
        accept=".npz"
        disabled={disabled || uploading}
        aria-label="Weights file"
        onChange={(event) => {
          const file = event.target.files?.[0];

          if (file) {
            upload(file);
          }

          event.target.value = "";
        }}
      />
    </>
  );
}
