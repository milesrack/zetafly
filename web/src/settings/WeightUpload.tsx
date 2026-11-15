import { Upload } from "lucide-react";
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
        className="weight-upload flex items-center justify-center gap-2.5 w-full m-[14px_0_12px] p-4 border border-dashed border-[#ccd2db] rounded-[var(--control-radius)] bg-[#fafbfc] text-[#4d5867] text-[12px] text-left"
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
        <Upload aria-hidden="true" />
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
