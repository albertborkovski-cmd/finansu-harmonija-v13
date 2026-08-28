import { useEffect, useRef, useState } from 'react';
import { ChevronDown, X } from 'lucide-react';

interface MultiSelectFieldProps {
  label: string;
  options?: string[];
  value?: string[];
  onChange?: (value: string[]) => void;
  placeholder?: string;
}

export default function MultiSelectField({
  label,
  options,
  value,
  onChange,
  placeholder,
}: MultiSelectFieldProps) {
  const selected = value ?? [];
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const closeOnOutsideClick = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };

    document.addEventListener('mousedown', closeOnOutsideClick);
    return () => document.removeEventListener('mousedown', closeOnOutsideClick);
  }, []);

  const toggleOption = (option: string) => {
    onChange?.(
      selected.includes(option)
        ? selected.filter(item => item !== option)
        : [...selected, option],
    );
  };

  return (
    <div ref={ref} className="flex w-full flex-col gap-2">
      <span className="font-montserrat text-[14px] font-semibold leading-[140%] text-[#10233A]">
        {label}
      </span>
      <div className="flex w-full flex-col items-start gap-1">
        <div
          className="w-full rounded-lg"
          style={open
            ? {
                border: '3px solid rgba(0,126,167,0.2)',
                display: 'flex',
                flexDirection: 'column',
                gap: '4px',
                padding: 0,
              }
            : {}}
        >
          <button
            type="button"
            onClick={() => setOpen(current => !current)}
            aria-expanded={open}
            aria-label={`Select ${label.toLowerCase()}`}
            className="box-border flex min-h-[42px] w-full cursor-pointer flex-row items-start justify-between gap-[2px] rounded-lg bg-white p-[9px] text-left transition-colors"
            style={{ border: open ? '1px solid #007EA7' : '1px solid #D3E1EC' }}
          >
            {selected.length > 0 ? (
              <div className="flex flex-1 flex-row flex-wrap items-center gap-1">
                {selected.map(item => (
                  <span
                    key={item}
                    className="box-border flex h-6 flex-row items-center gap-[2px] rounded border border-[#E5EDF9] bg-white px-2 py-1"
                  >
                    <span className="font-montserrat text-[10px] font-medium leading-4 text-[#10233A]">
                      {item}
                    </span>
                    <span
                      role="button"
                      tabIndex={0}
                      aria-label={`Remove ${item}`}
                      onClick={event => {
                        event.stopPropagation();
                        onChange?.(selected.filter(valueItem => valueItem !== item));
                      }}
                      onKeyDown={event => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault();
                          event.stopPropagation();
                          onChange?.(selected.filter(valueItem => valueItem !== item));
                        }
                      }}
                      className="flex h-4 w-4 items-center justify-center"
                    >
                      <X size={10} className="text-[#7288A3]" />
                    </span>
                  </span>
                ))}
              </div>
            ) : (
              <span className="flex-1 font-montserrat text-[14px] font-medium leading-[140%] text-[#A1B6C6]">
                {placeholder ?? 'Choose'}
              </span>
            )}
            <span className="flex items-center py-[3px]">
              <ChevronDown
                size={16}
                className={`flex-shrink-0 text-[#7288A3] transition-transform ${open ? 'rotate-180' : ''}`}
              />
            </span>
          </button>

          {open && (
            <div
              className="z-20 flex w-full flex-row items-start rounded-lg bg-white"
              style={{
                padding: '12px 8px 12px 12px',
                gap: '8px',
                maxHeight: '332px',
                boxShadow: '0px 8px 20px rgba(161, 182, 198, 0.35)',
              }}
            >
              <div className="flex max-h-[308px] flex-1 flex-col items-start overflow-y-auto">
                {(options ?? []).map(option => {
                  const checked = selected.includes(option);

                  return (
                    <button
                      key={option}
                      type="button"
                      role="checkbox"
                      aria-checked={checked}
                      onClick={() => toggleOption(option)}
                      className="flex h-7 w-full flex-row items-center gap-2 py-1 text-left"
                    >
                      <span
                        className="relative flex h-[18px] w-[18px] flex-shrink-0 items-center justify-center rounded-[6px]"
                        style={{
                          background: checked ? '#007EA7' : '#FFFFFF',
                          border: checked ? 'none' : '1px solid #A1B6C6',
                        }}
                      >
                        {checked && (
                          <svg width="10" height="8" viewBox="0 0 10 8" fill="none" aria-hidden="true">
                            <path
                              d="M1 4L3.5 6.5L9 1"
                              stroke="white"
                              strokeWidth="1.5"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            />
                          </svg>
                        )}
                      </span>
                      <span className="font-montserrat text-[14px] font-medium leading-5 text-[#7288A3]">
                        {option}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
