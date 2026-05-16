// Content sanitization for rosie installs.
//
// Two defenses, exposed as a single options struct so callers can disable
// either independently:
//
//   - strip_invisible: remove zero-width, Unicode Tag block, and bidi-override
//     codepoints that the LLM reads but a human reviewer can't see in
//     rendered markdown.
//
//   - strip_comments: remove markdown comments outside fenced code blocks.
//     Two forms — HTML (`<!-- ... -->`, possibly multi-line) and link-form
//     (`[//]: # "..."` / `[//]: # (...)`).
//
// See docs/security and design/security.md for the threat model.

use crate::os;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Copy)]
pub struct SanitizeOpts {
    pub strip_comments: bool,
    pub strip_invisible: bool,
}

impl SanitizeOpts {
    pub const ALL: SanitizeOpts = SanitizeOpts {
        strip_comments: true,
        strip_invisible: true,
    };

    pub const INVISIBLE_ONLY: SanitizeOpts = SanitizeOpts {
        strip_comments: false,
        strip_invisible: true,
    };

    pub const NONE: SanitizeOpts = SanitizeOpts {
        strip_comments: false,
        strip_invisible: false,
    };

    pub fn any(&self) -> bool {
        self.strip_comments || self.strip_invisible
    }
}

/// Sanitize reference content: strip comments and invisible chars per opts.
pub fn sanitize_reference(input: &str, opts: SanitizeOpts) -> String {
    let mut out = input.to_string();
    if opts.strip_comments {
        out = strip_comments(&out);
    }
    if opts.strip_invisible {
        out = strip_invisible(&out);
    }
    out
}

/// Sanitize skill content: strip invisible chars only (comments preserved —
/// skills are authored as agent input, their comments are intentional).
pub fn sanitize_skill(input: &str, opts: SanitizeOpts) -> String {
    if opts.strip_invisible {
        strip_invisible(input)
    } else {
        input.to_string()
    }
}

/// Walk `dir` recursively and rewrite every `.md` file with sanitize_skill.
/// Used after copy_dir_recursive to clean the canonical skill install.
pub fn sanitize_skill_dir(dir: &Path, opts: SanitizeOpts) -> os::Result<()> {
    if !opts.strip_invisible {
        return Ok(());
    }
    sanitize_skill_dir_inner(dir, opts)
}

fn sanitize_skill_dir_inner(dir: &Path, opts: SanitizeOpts) -> os::Result<()> {
    let entries = os::read_dir(dir)?;
    for name in entries {
        let path = PathBuf::from(dir).join(&name);
        if os::is_dir(&path) {
            sanitize_skill_dir_inner(&path, opts)?;
            continue;
        }
        if !is_markdown_file(&name) {
            continue;
        }
        let content = match os::read_to_string(&path) {
            Ok(c) => c,
            Err(_) => continue,
        };
        let cleaned = sanitize_skill(&content, opts);
        if cleaned != content {
            os::write(&path, cleaned.as_bytes())?;
        }
    }
    Ok(())
}

fn is_markdown_file(name: &str) -> bool {
    let lower = name.to_ascii_lowercase();
    lower.ends_with(".md") || lower.ends_with(".markdown")
}

// ---------------------------------------------------------------------------
// invisible-char stripping
// ---------------------------------------------------------------------------

fn strip_invisible(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for (byte_idx, c) in s.char_indices() {
        if is_invisible(c, byte_idx) {
            continue;
        }
        out.push(c);
    }
    out
}

fn is_invisible(c: char, byte_idx: usize) -> bool {
    match c {
        // Zero-width
        '\u{200B}' | '\u{200C}' | '\u{200D}' => true,
        // BOM is fine at the very start of the doc, hostile anywhere else
        '\u{FEFF}' if byte_idx != 0 => true,
        // Bidi overrides + isolates (Trojan Source class)
        '\u{202A}'..='\u{202E}' | '\u{2066}'..='\u{2069}' => true,
        // Unicode Tag block — invisible codepoints that encode arbitrary ASCII
        c if (c as u32) >= 0xE0000 && (c as u32) <= 0xE007F => true,
        _ => false,
    }
}

// ---------------------------------------------------------------------------
// markdown-comment stripping (outside fenced code blocks)
// ---------------------------------------------------------------------------

fn strip_comments(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut in_fence = false;
    let mut in_html_comment = false;

    for line in s.split_inclusive('\n') {
        let trimmed = line.trim_start();

        // Fence toggle has priority. An open HTML comment that crosses a fence
        // boundary is pathological; we end the comment implicitly at the fence.
        if trimmed.starts_with("```") || trimmed.starts_with("~~~") {
            in_fence = !in_fence;
            in_html_comment = false;
            out.push_str(line);
            continue;
        }
        if in_fence {
            out.push_str(line);
            continue;
        }

        let processed = process_line(line, &mut in_html_comment);
        out.push_str(&processed);
    }

    out
}

fn process_line(line: &str, in_html_comment: &mut bool) -> String {
    // Strip HTML comments first (handles single-line and multi-line state).
    let stripped_html = strip_html_comments_on_line(line, in_html_comment);

    // After HTML stripping, check whether the line is a link-form comment.
    if is_link_form_comment_line(&stripped_html) {
        return String::new();
    }
    stripped_html
}

fn strip_html_comments_on_line(line: &str, in_html_comment: &mut bool) -> String {
    let chars: Vec<char> = line.chars().collect();
    let n = chars.len();
    let mut out = String::with_capacity(line.len());
    let mut i = 0;

    while i < n {
        if *in_html_comment {
            if i + 2 < n && chars[i] == '-' && chars[i + 1] == '-' && chars[i + 2] == '>' {
                *in_html_comment = false;
                i += 3;
                continue;
            }
            i += 1;
            continue;
        }

        if i + 3 < n
            && chars[i] == '<'
            && chars[i + 1] == '!'
            && chars[i + 2] == '-'
            && chars[i + 3] == '-'
        {
            // Search for closing --> on or after this position.
            let mut j = i + 4;
            let mut closed_at: Option<usize> = None;
            while j + 2 < n {
                if chars[j] == '-' && chars[j + 1] == '-' && chars[j + 2] == '>' {
                    closed_at = Some(j);
                    break;
                }
                j += 1;
            }
            // Also check the last 3 chars (loop above stops before n-2).
            if closed_at.is_none() && n >= 3 && i + 4 <= n - 3 {
                let last = n - 3;
                if last >= i + 4
                    && chars[last] == '-'
                    && chars[last + 1] == '-'
                    && chars[last + 2] == '>'
                {
                    closed_at = Some(last);
                }
            }
            if let Some(end) = closed_at {
                i = end + 3;
                continue;
            }
            // Unterminated: rest of line is inside the comment, continue on next line.
            *in_html_comment = true;
            // Preserve the trailing newline if there is one.
            if line.ends_with('\n') {
                out.push('\n');
            }
            return out;
        }

        out.push(chars[i]);
        i += 1;
    }

    out
}

fn is_link_form_comment_line(line: &str) -> bool {
    let trimmed = line.trim();
    if !trimmed.starts_with("[//]:") {
        return false;
    }
    let rest = trimmed[5..].trim_start();
    if !rest.starts_with('#') {
        return false;
    }
    let rest = rest[1..].trim_start();
    if rest.is_empty() {
        return true;
    }
    let first = rest.chars().next().unwrap();
    matches!(first, '"' | '\'' | '(')
}

// ---------------------------------------------------------------------------
// tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn strips_zero_width() {
        let input = "hello\u{200B}world\u{200C}foo\u{200D}bar";
        assert_eq!(strip_invisible(input), "helloworldfoobar");
    }

    #[test]
    fn strips_bidi_overrides() {
        let input = "ok\u{202E}reversed\u{202C}";
        assert_eq!(strip_invisible(input), "okreversed");
    }

    #[test]
    fn strips_unicode_tag_block() {
        let input = "visible\u{E0070}\u{E0061}\u{E0079}content";
        assert_eq!(strip_invisible(input), "visiblecontent");
    }

    #[test]
    fn preserves_leading_bom() {
        let input = "\u{FEFF}rest";
        assert_eq!(strip_invisible(input), "\u{FEFF}rest");
    }

    #[test]
    fn strips_nonleading_bom() {
        let input = "rest\u{FEFF}of\u{FEFF}doc";
        assert_eq!(strip_invisible(input), "restofdoc");
    }

    #[test]
    fn strips_html_comment_single_line() {
        let input = "before<!-- hidden -->after\n";
        assert_eq!(strip_comments(input), "beforeafter\n");
    }

    #[test]
    fn strips_html_comment_multi_line() {
        let input = "a\n<!--\nignored\nstill ignored\n-->\nb\n";
        // The intermediate lines become empty (content was inside the comment),
        // but their newlines are preserved as blank lines.
        let out = strip_comments(input);
        assert!(out.contains("a\n"));
        assert!(out.contains("b\n"));
        assert!(!out.contains("ignored"));
    }

    #[test]
    fn preserves_html_comment_inside_fence() {
        let input = "```\n<!-- preserved -->\n```\n";
        assert_eq!(strip_comments(input), input);
    }

    #[test]
    fn preserves_tilde_fence() {
        let input = "~~~\n<!-- preserved -->\n~~~\n";
        assert_eq!(strip_comments(input), input);
    }

    #[test]
    fn strips_link_form_quoted() {
        let input = "before\n[//]: # \"hidden\"\nafter\n";
        assert_eq!(strip_comments(input), "before\nafter\n");
    }

    #[test]
    fn strips_link_form_parenthesized() {
        let input = "[//]: # (hidden)\n";
        assert_eq!(strip_comments(input), "");
    }

    #[test]
    fn preserves_link_form_inside_fence() {
        let input = "```\n[//]: # \"preserved\"\n```\n";
        assert_eq!(strip_comments(input), input);
    }

    #[test]
    fn sanitize_skill_keeps_comments() {
        let input = "<!-- skill author wrote this -->\ntext";
        let out = sanitize_skill(input, SanitizeOpts::ALL);
        assert_eq!(out, input);
    }

    #[test]
    fn sanitize_reference_strips_both() {
        let input = "<!-- hide -->visible\u{200B}\n";
        let out = sanitize_reference(input, SanitizeOpts::ALL);
        assert_eq!(out, "visible\n");
    }

    #[test]
    fn sanitize_reference_respects_opts() {
        let input = "<!-- keep -->\u{200B}gone";
        let only_invisible = sanitize_reference(input, SanitizeOpts::INVISIBLE_ONLY);
        assert_eq!(only_invisible, "<!-- keep -->gone");
    }
}
