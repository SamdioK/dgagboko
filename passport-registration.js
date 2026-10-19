/* =========================================================
   DE-GLOBAL ACADEMY — STUDENT PASSPORT REGISTRATION
   File: passport-registration.js
   Uses the existing portal Supabase session and student data.
   ========================================================= */

(function () {
  'use strict';

  var BUCKET = 'student-passports';
  var MAX_FILE_SIZE = 5 * 1024 * 1024;
  var allowedTypes = ['image/jpeg', 'image/png', 'image/webp'];

  var state = {
    classes: [],
    students: [],
    selectedClassId: '',
    search: '',
    busy: false,
    loaded: false
  };

  function escapeHtml(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (c) {
      return {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
      }[c];
    });
  }

  function passportNotice(message, type) {
    var box = document.getElementById('passportNotice');
    if (!box) return;

    box.textContent = message;
    box.className = 'passport-notice ' + (type || 'info');
    box.style.display = 'block';
  }

  function passportName(student) {
    if (typeof studentDbName === 'function') {
      return studentDbName(student);
    }

    return [
      student.first_name,
      student.middle_name,
      student.last_name
    ].filter(Boolean).join(' ') ||
      student.full_name ||
      student.name ||
      'Unnamed student';
  }

  function admissionCode(admissionNumber) {
    var value = String(admissionNumber || '').trim();
    var digits = value.match(/\d/g);

    if (!value || !digits || digits.length < 3) return '';

    return value.charAt(0).toUpperCase() +
      digits.slice(-3).join('');
  }

  function requireAdmin() {
    if (!window.supabaseClient ||
        !window.authenticatedProfile ||
        !window.currentUser) {
      throw new Error('Your session is unavailable. Sign in again.');
    }

    if (currentUser.type !== 'admin' ||
        String(authenticatedProfile.role || '').toLowerCase() !== 'administrator' ||
        authenticatedProfile.is_active !== true ||
        !authenticatedProfile.school_id) {
      throw new Error('Only an active school administrator can manage passports.');
    }

    return authenticatedProfile;
  }

  function passportStyles() {
    if (document.getElementById('passportRegistrationStyles')) return;

    var style = document.createElement('style');
    style.id = 'passportRegistrationStyles';

    style.textContent = `
      #passportRegistrationTab {
        min-width: 0;
        width: 100%;
      }

      .passport-page {
        max-width: 1200px;
        margin: 0 auto;
        padding: clamp(10px, 2vw, 24px);
        color: #172033;
      }

      .passport-heading {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        flex-wrap: wrap;
        margin-bottom: 18px;
      }

      .passport-heading h2 {
        margin: 0 0 5px;
        font-size: clamp(20px, 3vw, 28px);
      }

      .passport-muted {
        color: #667085;
        font-size: 13px;
        line-height: 1.5;
      }

      .passport-panel {
        background: #fff;
        border: 1px solid #e1e7f0;
        border-radius: 14px;
        padding: 16px;
        margin-bottom: 16px;
        box-shadow: 0 3px 12px rgba(20, 35, 70, .04);
        min-width: 0;
      }

      .passport-class-grid {
        display: grid;
        gap: 18px;
        min-width: 0;
      }

      .passport-class-picker-group {
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 12px;
      }

      .passport-class-level {
        min-width: 0;
        padding: 12px;
        border: 1px solid #e1e6f2;
        border-radius: 12px;
        background: linear-gradient(180deg, #f8faff, #fff);
        box-shadow: 0 3px 10px rgba(42, 61, 112, .07);
      }

      .passport-class-level-banner {
        display: block;
        width: 100%;
        box-sizing: border-box;
        padding: 10px 12px;
        border: 0;
        border-radius: 8px;
        background: linear-gradient(120deg, #536bd8, #7352a6);
        color: #fff;
        text-align: center;
        font-size: 14px;
        font-weight: 700;
        letter-spacing: .04em;
        box-shadow: 0 3px 8px rgba(66, 76, 151, .2);
      }

      .passport-class-picker-group.senior
      .passport-class-level-banner {
        background: linear-gradient(120deg, #13827c, #3068a7);
      }

      .passport-class-arms {
        display: flex;
        justify-content: center;
        align-items: flex-start;
        flex-wrap: wrap;
        gap: 8px;
        padding-top: 2px;
      }

      .passport-class-arm {
        position: relative;
        min-width: 42px;
        margin-top: 13px;
        padding: 9px 12px;
        border: 1px solid #d9e1f2;
        border-radius: 9px;
        background: #fff;
        color: #34436f;
        font-size: 13px;
        font-weight: 700;
        cursor: pointer;
        box-shadow: 0 3px 8px rgba(34, 51, 94, .1);
        transition: transform .16s ease,
          box-shadow .16s ease,
          border-color .16s ease,
          background .16s ease;
      }

      .passport-class-arm::before {
        position: absolute;
        top: -14px;
        left: 50%;
        width: 2px;
        height: 14px;
        background: #9aa7c0;
        content: '';
        transform: translateX(-50%);
      }

      .passport-class-arm:hover {
        transform: translateY(2px);
        border-color: #7588db;
        box-shadow: 0 5px 12px rgba(34, 51, 94, .16);
      }

      .passport-class-arm.selected {
        border-color: #4c62ca;
        background: #e9edff;
        color: #293eaa;
        box-shadow: 0 0 0 2px rgba(76, 98, 202, .18),
          0 4px 10px rgba(34, 51, 94, .12);
      }

      .passport-class-arm:focus-visible {
        outline: 3px solid #f0b429;
        outline-offset: 2px;
      }

      .passport-class-other {
        margin-top: 12px;
      }

      .passport-class-other .passport-class-arms {
        justify-content: flex-start;
      }

      @media (max-width: 768px) {
        .passport-class-picker-group {
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 9px;
        }
      }

      @media (max-width: 420px) {
        .passport-class-picker-group {
          grid-template-columns: 1fr;
        }

        .passport-class-level {
          padding: 10px;
        }
      }

      .passport-toolbar {
        display: flex;
        align-items: center;
        gap: 10px;
        flex-wrap: wrap;
        margin-bottom: 14px;
      }

      .passport-search {
        flex: 1 1 220px;
        min-width: 0;
        width: 100%;
        box-sizing: border-box;
        border: 1px solid #ccd5e2;
        border-radius: 9px;
        padding: 11px 12px;
        font-size: 15px;
      }

      .passport-count {
        font-size: 13px;
        color: #667085;
      }

      .passport-student-scroller {
        min-width: 0;
        width: 100%;
      }

      .passport-scroll-controls {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
        margin-bottom: 10px;
      }

      .passport-scroll-controls span {
        flex: 1;
        text-align: center;
        color: #667085;
        font-size: 12px;
        line-height: 1.5;
      }

      .passport-scroll-button {
        flex: 0 0 auto;
        min-width: 44px;
        min-height: 42px;
        padding: 8px 12px;
        border: 1px solid #ccd5e2;
        border-radius: 8px;
        background: #f8faff;
        color: #23324c;
        font-size: 22px;
        font-weight: bold;
        cursor: pointer;
        touch-action: manipulation;
      }

      .passport-scroll-button:focus-visible {
        outline: 2px solid #315fc4;
        outline-offset: 2px;
      }

      .passport-scroll-button:disabled {
        opacity: .4;
        cursor: not-allowed;
      }

      .passport-student-grid {
        display: flex;
        gap: 14px;
        min-width: 0;
        width: 100%;
        overflow-x: auto;
        overflow-y: hidden;
        padding: 2px 2px 12px;
        box-sizing: border-box;
        scroll-snap-type: x mandatory;
        scroll-behavior: smooth;
        -webkit-overflow-scrolling: touch;
        overscroll-behavior-x: contain;
      }

      .passport-student-grid:focus-visible {
        outline: 2px solid #315fc4;
        outline-offset: 2px;
      }

      .passport-student-grid > .passport-empty {
        flex: 0 0 100%;
        box-sizing: border-box;
      }

      .passport-student-card {
        flex: 0 0 285px;
        min-width: 0;
        scroll-snap-align: start;
        border: 1px solid #e0e6ef;
        border-radius: 13px;
        overflow: hidden;
        background: #fff;
        box-sizing: border-box;
      }

      .passport-photo-area {
        min-height: 170px;
        background: #f2f5fa;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 12px;
      }

      .passport-photo {
        width: 120px;
        height: 140px;
        object-fit: cover;
        border-radius: 8px;
        border: 1px solid #d8dfeb;
        background: white;
      }

      .passport-no-photo {
        width: 120px;
        height: 140px;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 8px;
        text-align: center;
        border: 1px dashed #bac5d6;
        border-radius: 8px;
        color: #667085;
        font-size: 12px;
        padding: 8px;
        box-sizing: border-box;
      }

      .passport-student-info {
        padding: 13px;
        min-width: 0;
      }

      .passport-student-info h3 {
        font-size: 15px;
        margin: 0 0 7px;
        overflow-wrap: anywhere;
      }

      .passport-student-info p {
        font-size: 12px;
        margin: 5px 0;
        color: #5b6576;
        overflow-wrap: anywhere;
      }

      .passport-status {
        display: inline-block;
        border-radius: 20px;
        padding: 5px 9px;
        font-size: 11px;
        font-weight: 700;
        margin: 3px 0 10px;
      }

      .passport-status.complete {
        background: #e3f6e9;
        color: #176534;
      }

      .passport-status.missing {
        background: #fff0d7;
        color: #855000;
      }

      .passport-actions {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        margin-top: 10px;
      }

      .passport-action {
        border: 0;
        border-radius: 8px;
        padding: 10px 12px;
        cursor: pointer;
        font-size: 13px;
        font-weight: 600;
        touch-action: manipulation;
      }

      .passport-action:disabled {
        opacity: .55;
        cursor: not-allowed;
      }

      .passport-primary {
        background: #2457b8;
        color: #fff;
      }

      .passport-danger {
        background: #fff0f0;
        color: #a32323;
        border: 1px solid #efc6c6;
      }

      .passport-notice {
        display: none;
        margin: 0 0 14px;
        padding: 12px;
        border-radius: 9px;
        overflow-wrap: anywhere;
        white-space: pre-line;
        font-size: 14px;
      }

      .passport-notice.info {
        background: #edf4ff;
        color: #214b8f;
      }

      .passport-notice.success {
        background: #e7f7ec;
        color: #176534;
      }

      .passport-notice.error {
        background: #fff0f0;
        color: #9b2525;
      }

      .passport-empty {
        padding: 26px 12px;
        text-align: center;
        color: #667085;
        border: 1px dashed #d5dce7;
        border-radius: 10px;
      }

      .passport-file-input {
        display: none;
      }

      @media (max-width: 520px) {
        .passport-page {
          padding: 9px;
        }

        .passport-panel {
          padding: 12px;
        }

        .passport-student-card {
          flex-basis: min(86vw, 360px);
          display: grid;
          grid-template-columns: 112px minmax(0, 1fr);
        }

        .passport-photo-area {
          min-height: 0;
          padding: 8px;
        }

        .passport-photo {
          width: 94px;
          height: 118px;
        }

        .passport-no-photo {
          width: 94px;
          height: 118px;
        }

        .passport-student-info {
          padding: 10px;
        }

        .passport-actions {
          flex-direction: column;
        }

        .passport-action {
          width: 100%;
          box-sizing: border-box;
        }

        .passport-scroll-controls span {
          font-size: 11px;
        }
      }

      @media (prefers-reduced-motion: reduce) {
        .passport-student-grid {
          scroll-behavior: auto;
        }
      }
    `;

    document.head.appendChild(style);
  }

  function ensureContainer() {
    var tab = document.getElementById('passportRegistrationTab');

    if (!tab) {
      throw new Error('Passport tab container is missing from index.html.');
    }

    tab.innerHTML = `
      <div class="passport-page">
        <div class="passport-heading">
          <div>
            <h2>Student Passport Registration</h2>
            <div class="passport-muted">
              Register and manage official student passport photographs.
            </div>
          </div>

          <button type="button"
            class="passport-action passport-primary"
            id="passportRefreshBtn">
            Refresh records
          </button>
        </div>

        <div id="passportNotice"
          class="passport-notice"
          role="status"
          aria-live="polite"></div>

        <section class="passport-panel">
          <h3 style="margin:0 0 5px;font-size:16px;">
            Select class and arm
          </h3>

          <p class="passport-muted" style="margin:0 0 13px;">
            Choose the student's current class to display its official register.
          </p>

          <div id="passportClassGrid" class="passport-class-grid">
            <div class="passport-empty">Loading classes…</div>
          </div>
        </section>

        <section class="passport-panel">
          <div class="passport-toolbar">
            <input id="passportStudentSearch"
              class="passport-search"
              type="search"
              placeholder="Search student name, SID or admission number"
              aria-label="Search students">

            <span id="passportStudentCount"
              class="passport-count"></span>
          </div>

          <div class="passport-student-scroller">
            <div class="passport-scroll-controls">
              <button type="button"
                id="passportStudentsPrev"
                class="passport-scroll-button"
                aria-label="Previous students"
                title="Previous students"
                disabled>
                ‹
              </button>

              <span>
                Swipe or use the arrows to view students in this class/arm.
              </span>

              <button type="button"
                id="passportStudentsNext"
                class="passport-scroll-button"
                aria-label="Next students"
                title="Next students"
                disabled>
                ›
              </button>
            </div>

            <div id="passportStudentGrid"
              class="passport-student-grid"
              tabindex="0"
              aria-label="Students in selected class or arm">
              <div class="passport-empty">
                Select a class to view students.
              </div>
            </div>
          </div>
        </section>
      </div>

      <input id="passportUploadInput"
        class="passport-file-input"
        type="file"
        accept="image/jpeg,image/png,image/webp">
    `;

    document.getElementById('passportRefreshBtn').onclick = function () {
      loadPassportRegistration(true);
    };

    document.getElementById('passportStudentSearch').oninput = function () {
      state.search = this.value.trim().toLowerCase();
      renderPassportStudents();
    };

    document.getElementById('passportStudentsPrev').onclick = function () {
      scrollPassportStudents(-1);
    };

    document.getElementById('passportStudentsNext').onclick = function () {
      scrollPassportStudents(1);
    };

    document.getElementById('passportStudentGrid').onscroll = function () {
      updatePassportScrollButtons();
    };

    document.getElementById('passportClassGrid').onclick = function (event) {
      var button = event.target.closest('[data-passport-class]');

      if (!button) return;

      var newClassId = button.getAttribute('data-passport-class');

      if (String(newClassId) === String(state.selectedClassId)) return;

      state.selectedClassId = newClassId;
      state.students = [];

      renderPassportClasses();
      renderPassportStudents();
      loadPassportStudents();
    };

    document.getElementById('passportStudentGrid').onclick = function (event) {
      var button = event.target.closest('[data-passport-action]');

      if (!button || state.busy) return;

      var studentId = button.getAttribute('data-student-id');
      var action = button.getAttribute('data-passport-action');

      if (action === 'upload' || action === 'replace') {
        var student = state.students.find(function (item) {
          return String(item.student.id) === String(studentId);
        });

        if (!student) return;

        if (action === 'replace' && !confirm(
          'This student already has a passport photograph. Do you want to replace it?'
        )) return;

        var input = document.getElementById('passportUploadInput');

        input.value = '';
        input.dataset.studentId = studentId;
        input.dataset.replace = action === 'replace' ? 'yes' : 'no';
        input.click();
      }

      if (action === 'remove') {
        removeStudentPassport(studentId);
      }
    };

    document.getElementById('passportUploadInput').onchange = async function () {
      var file = this.files && this.files[0];
      var studentId = this.dataset.studentId;
      var isReplacement = this.dataset.replace === 'yes';

      if (!file || !studentId) return;

      await uploadStudentPassport(studentId, file, isReplacement);
      this.value = '';
    };

    installBulkPassportControls();
    updatePassportScrollButtons();
  }

  // Scroll the student register one card at a time.
  function scrollPassportStudents(direction) {
    var grid = document.getElementById('passportStudentGrid');

    if (!grid) return;

    var card = grid.querySelector('.passport-student-card');

    var distance = card
      ? card.getBoundingClientRect().width + 14
      : Math.max(220, grid.clientWidth * 0.8);

    if (typeof grid.scrollBy === 'function') {
      grid.scrollBy({
        left: direction * distance,
        behavior: 'smooth'
      });
    } else {
      grid.scrollLeft += direction * distance;
    }

    updatePassportScrollButtons();
  }

  // Enable or disable the navigation arrows based on scroll position.
  function updatePassportScrollButtons() {
    var grid = document.getElementById('passportStudentGrid');
    var prev = document.getElementById('passportStudentsPrev');
    var next = document.getElementById('passportStudentsNext');

    if (!grid || !prev || !next) return;

    var maxScroll = Math.max(0, grid.scrollWidth - grid.clientWidth);
    var hasCards = !!grid.querySelector('.passport-student-card');

    prev.disabled = !hasCards || grid.scrollLeft <= 2;
    next.disabled = !hasCards || grid.scrollLeft >= maxScroll - 2;
  }

  // Bulk passport files are matched to enrolled students by admission number.
  function installBulkPassportControls() {
    var heading = document.querySelector(
      '#passportRegistrationTab .passport-heading'
    );

    if (!heading || document.getElementById('passportBulkInput')) return;

    var button = document.createElement('button');
    button.type = 'button';
    button.id = 'passportBulkButton';
    button.className = 'passport-action passport-primary';
    button.textContent = 'Bulk upload passports';

    var input = document.createElement('input');
    input.type = 'file';
    input.id = 'passportBulkInput';
    input.accept = 'image/jpeg,image/png,image/webp';
    input.multiple = true;
    input.className = 'passport-file-input';

    heading.appendChild(button);
    document.getElementById('passportRegistrationTab').appendChild(input);

    button.onclick = function () {
      if (state.busy) {
        passportNotice('Please wait for the current operation to finish.', 'error');
        return;
      }

      if (!state.selectedClassId || !state.students.length) {
        passportNotice('Select a class and load its student register first.', 'error');
        return;
      }

      input.value = '';
      input.click();
    };

    input.onchange = async function () {
      var files = Array.from(input.files || []);

      if (!files.length) return;

      var normalize = function (value) {
        return String(value || '')
          .trim()
          .toUpperCase()
          .replace(/[^A-Z0-9]/g, '');
      };

      var studentsByAdmission = Object.create(null);

      state.students.forEach(function (item) {
        var key = normalize(item.student.admission_number);

        if (!key) return;

        if (!studentsByAdmission[key]) {
          studentsByAdmission[key] = [];
        }

        studentsByAdmission[key].push(item);
      });

      var usedStudents = Object.create(null);
      var usedKeys = Object.create(null);
      var matches = [];
      var problems = [];

      files.forEach(function (file) {
        var extension = file.name.match(/\.[^.]+$/);
        var stem = extension
          ? file.name.slice(0, -extension[0].length)
          : file.name;

        var key = normalize(stem);

        if (!key) {
          problems.push(file.name + ': filename has no admission number.');
          return;
        }

        if (usedKeys[key]) {
          problems.push(file.name + ': duplicate admission-number filename.');
          return;
        }

        usedKeys[key] = true;

        var candidates = studentsByAdmission[key] || [];

        if (candidates.length === 0) {
          problems.push(file.name + ': no matching student in the selected class.');
          return;
        }

        if (candidates.length > 1) {
          problems.push(file.name + ': admission number matches multiple students.');
          return;
        }

        var item = candidates[0];
        var studentId = String(item.student.id);

        if (usedStudents[studentId]) {
          problems.push(file.name + ': this student already has another selected image.');
          return;
        }

        usedStudents[studentId] = true;

        if (item.passport && item.passport.storage_path) {
          problems.push(
            file.name + ': SKIPPED — ' + passportName(item.student) +
            ' already has a passport.'
          );
          return;
        }

        if (allowedTypes.indexOf(file.type) === -1) {
          problems.push(file.name + ': unsupported image type.');
          return;
        }

        if (file.size > MAX_FILE_SIZE) {
          problems.push(file.name + ': image exceeds the 5 MB limit.');
          return;
        }

        matches.push({
          file: file,
          item: item
        });
      });

      if (!matches.length) {
        passportNotice(
          'No eligible passport matches were found.' +
          (problems.length ? '\n' + problems.join('\n') : ''),
          'error'
        );
        return;
      }

      var preview = matches.map(function (match, index) {
        return (index + 1) + '. ' +
          passportName(match.item.student) + ' — ' +
          match.item.student.admission_number + ' ← ' +
          match.file.name;
      }).join('\n');

      var message =
        'REVIEW BULK PASSPORT MATCHES\n\n' +
        preview +
        '\n\nReady to upload: ' + matches.length +
        '\nSkipped or flagged: ' + problems.length +
        (problems.length ? '\n\n' + problems.join('\n') : '') +
        '\n\nContinue with these matches?';

      if (!confirm(message)) {
        passportNotice('Bulk upload cancelled. No files were uploaded.', 'info');
        return;
      }

      var completed = 0;
      var failed = [];

      for (var i = 0; i < matches.length; i++) {
        var match = matches[i];

        passportNotice(
          'Uploading passport ' + (i + 1) + ' of ' + matches.length +
          ': ' + passportName(match.item.student),
          'info'
        );

        try {
          await uploadStudentPassport(
            match.item.student.id,
            match.file,
            false
          );

          var latest = state.students.find(function (row) {
            return String(row.student.id) === String(match.item.student.id);
          });

          if (latest && latest.passport && latest.passport.storage_path) {
            completed++;
          } else {
            failed.push(match.file.name + ': upload could not be confirmed.');
          }
        } catch (error) {
          failed.push(match.file.name + ': ' + (error.message || 'Upload failed.'));
        }
      }

      passportNotice(
        'Bulk upload finished. Confirmed: ' + completed +
        '. Failed or unconfirmed: ' + failed.length +
        (failed.length ? '\n' + failed.join('\n') : ''),
        failed.length ? 'error' : 'success'
      );

      await loadPassportStudents();
      input.value = '';
    };
  }

  async function loadPassportRegistration(showMessage) {
    try {
      requireAdmin();

      if (!activeAcademicSession || !activeAcademicSession.id) {
        throw new Error('There is no active academic session. Set the active session first.');
      }

      passportStyles();
      ensureContainer();

      var classResult = await supabaseClient
        .from('classes')
        .select('id,class_name')
        .eq('school_id', authenticatedProfile.school_id)
        .order('class_name');

      if (classResult.error) throw classResult.error;

      state.classes = classResult.data || [];

      if (!state.selectedClassId ||
          !state.classes.some(function (item) {
            return String(item.id) === String(state.selectedClassId);
          })) {
        state.selectedClassId = '';
      }

      renderPassportClasses();

      if (state.selectedClassId) {
        await loadPassportStudents();
      } else {
        state.students = [];
        renderPassportStudents();
      }

      state.loaded = true;

      if (showMessage) {
        passportNotice('Passport records refreshed.', 'success');
      }
    } catch (error) {
      passportNotice(error.message || 'Unable to load passport registration.', 'error');
    }
  }

  function classLevel(name) {
    var value = String(name || '').toUpperCase().replace(/\s+/g, '');

    if (value.indexOf('BASIC7') === 0) return 'BASIC 7';
    if (value.indexOf('BASIC8') === 0) return 'BASIC 8';
    if (value.indexOf('BASIC9') === 0) return 'BASIC 9';
    if (value.indexOf('SS1') === 0) return 'SS 1';
    if (value.indexOf('SS2') === 0) return 'SS 2';
    if (value.indexOf('SS3') === 0) return 'SS 3';

    return 'Other classes';
  }

  function renderPassportClasses() {
    var grid = document.getElementById('passportClassGrid');
    if (!grid) return;

    if (!state.classes.length) {
      grid.innerHTML =
        '<div class="passport-empty">' +
        'No classes were found for this school.' +
        '</div>';
      return;
    }

    var levels = [
      { key: 'BASIC7', label: 'BASIC 7', group: 'basic' },
      { key: 'BASIC8', label: 'BASIC 8', group: 'basic' },
      { key: 'BASIC9', label: 'BASIC 9', group: 'basic' },
      { key: 'SS1', label: 'SS 1', group: 'senior' },
      { key: 'SS2', label: 'SS 2', group: 'senior' },
      { key: 'SS3', label: 'SS 3', group: 'senior' }
    ];

    var grouped = {};
    var otherClasses = [];

    levels.forEach(function (level) {
      grouped[level.key] = [];
    });

    state.classes.forEach(function (item) {
      var name = String(item.class_name || '')
        .toUpperCase()
        .replace(/\s+/g, '');

      var level = levels.find(function (candidate) {
        return name.indexOf(candidate.key) === 0;
      });

      if (level) {
        grouped[level.key].push(item);
      } else {
        otherClasses.push(item);
      }
    });

    function renderLevel(level) {
      var arms = grouped[level.key].slice().sort(function (a, b) {
        return String(a.class_name).localeCompare(
          String(b.class_name),
          undefined,
          { numeric: true }
        );
      });

      var buttons = arms.map(function (item) {
        var name = String(item.class_name || '')
          .toUpperCase()
          .replace(/\s+/g, '');

        var armLabel = name.indexOf(level.key) === 0
          ? name.slice(level.key.length)
          : item.class_name;

        var selected =
          String(item.id) === String(state.selectedClassId);

        return `
          <button
            type="button"
            class="passport-class-arm${selected ? ' selected' : ''}"
            data-passport-class="${escapeHtml(item.id)}"
            aria-pressed="${selected}"
            aria-label="Select ${escapeHtml(item.class_name)}"
            title="${escapeHtml(item.class_name)}"
          >${escapeHtml(armLabel || item.class_name)}</button>
        `;
      }).join('');

      return `
        <section class="passport-class-level"
          aria-label="${escapeHtml(level.label)} class arms">

          <div class="passport-class-level-banner">
            ${escapeHtml(level.label)}
          </div>

          <div class="passport-class-arms">
            ${buttons || '<span class="passport-muted">No arms available</span>'}
          </div>
        </section>
      `;
    }

    var html = '';

    html += '<div class="passport-class-picker-group basic">';

    levels.filter(function (level) {
      return level.group === 'basic';
    }).forEach(function (level) {
      html += renderLevel(level);
    });

    html += '</div>';

    html += '<div class="passport-class-picker-group senior">';

    levels.filter(function (level) {
      return level.group === 'senior';
    }).forEach(function (level) {
      html += renderLevel(level);
    });

    html += '</div>';

    if (otherClasses.length) {
      html += `
        <section class="passport-class-level passport-class-other">
          <div class="passport-class-level-banner">
            Other Classes
          </div>

          <div class="passport-class-arms">
            ${otherClasses.map(function (item) {
              var selected =
                String(item.id) === String(state.selectedClassId);

              return `
                <button
                  type="button"
                  class="passport-class-arm${selected ? ' selected' : ''}"
                  data-passport-class="${escapeHtml(item.id)}"
                  aria-pressed="${selected}"
                  aria-label="Select ${escapeHtml(item.class_name)}"
                >${escapeHtml(item.class_name)}</button>
              `;
            }).join('')}
          </div>
        </section>
      `;
    }

    grid.innerHTML = html;
  }

  async function loadPassportStudents() {
    var requestedClassId = state.selectedClassId;

    try {
      requireAdmin();

      if (!state.selectedClassId) {
        state.students = [];
        renderPassportStudents();
        return;
      }

      passportNotice('Loading official class register…', 'info');

      var enrolmentResult = await supabaseClient
        .from('student_enrolments')
        .select('*')
        .eq('school_id', authenticatedProfile.school_id)
        .eq('academic_session_id', activeAcademicSession.id)
        .eq('class_id', requestedClassId)
        .order('register_number');

      if (enrolmentResult.error) throw enrolmentResult.error;

      var enrolments = enrolmentResult.data || [];

      var studentIds = enrolments.map(function (row) {
        return row.student_id;
      }).filter(Boolean);

      if (!studentIds.length) {
        if (String(state.selectedClassId) !== String(requestedClassId)) return;

        state.students = [];
        renderPassportStudents();

        passportNotice(
          'There are no enrolled students in this class for the active session.',
          'info'
        );

        return;
      }

      var studentResult = await supabaseClient
        .from('students')
        .select('*')
        .eq('school_id', authenticatedProfile.school_id)
        .in('id', studentIds);

      if (studentResult.error) throw studentResult.error;

      var studentMap = {};

      (studentResult.data || []).forEach(function (student) {
        studentMap[String(student.id)] = student;
      });

      var passportResult = await supabaseClient
        .from('student_passports')
        .select('id,student_id,storage_path,updated_at')
        .eq('school_id', authenticatedProfile.school_id)
        .in('student_id', studentIds);

      if (passportResult.error) throw passportResult.error;

      var passportMap = {};

      (passportResult.data || []).forEach(function (passport) {
        passportMap[String(passport.student_id)] = passport;
      });

      var loadedStudents = [];

      for (var i = 0; i < enrolments.length; i++) {
        var enrolment = enrolments[i];
        var student = studentMap[String(enrolment.student_id)];

        if (!student) continue;

        var passport = passportMap[String(student.id)] || null;
        var imageUrl = '';

        if (passport && passport.storage_path) {
          var signed = await supabaseClient.storage
            .from(BUCKET)
            .createSignedUrl(passport.storage_path, 3600);

          if (!signed.error && signed.data) {
            imageUrl = signed.data.signedUrl;
          }
        }

        loadedStudents.push({
          student: student,
          enrolment: enrolment,
          passport: passport,
          imageUrl: imageUrl
        });
      }

      // Prevent an older request from overwriting a newly selected class.
      if (String(state.selectedClassId) !== String(requestedClassId)) return;

      state.students = loadedStudents;

      renderPassportStudents();

      passportNotice('Class register loaded successfully.', 'success');
    } catch (error) {
      if (String(state.selectedClassId) !== String(requestedClassId)) return;

      state.students = [];
      renderPassportStudents();

      passportNotice(
        error.message || 'Could not load the class register.',
        'error'
      );
    }
  }

  function renderPassportStudents() {
    var grid = document.getElementById('passportStudentGrid');
    var count = document.getElementById('passportStudentCount');

    if (!grid || !count) return;

    var term = state.search;

    var filtered = state.students.filter(function (item) {
      var student = item.student || {};
      var enrolment = item.enrolment || {};

      var text = [
        passportName(student),
        student.admission_number,
        enrolment.sid,
        enrolment.register_number
      ].join(' ').toLowerCase();

      return !term || text.indexOf(term) !== -1;
    });

    count.textContent =
      filtered.length + ' of ' + state.students.length + ' students';

    if (!state.selectedClassId) {
      grid.innerHTML =
        '<div class="passport-empty">Select a class or arm above to begin.</div>';

      updatePassportScrollButtons();
      return;
    }

    if (!filtered.length) {
      grid.innerHTML =
        '<div class="passport-empty">No students match your search in this class.</div>';

      updatePassportScrollButtons();
      return;
    }

    grid.innerHTML = filtered.map(function (item) {
      var student = item.student;
      var enrolment = item.enrolment;
      var passport = item.passport;

      var hasPassport = !!(passport && passport.storage_path);

      var image = item.imageUrl
        ? '<img class="passport-photo" src="' + escapeHtml(item.imageUrl) +
          '" alt="Passport photograph of ' +
          escapeHtml(passportName(student)) + '">'
        : '<div class="passport-no-photo">' +
          '<span style="font-size:25px">👤</span>' +
          '<span>' +
          (hasPassport ? 'Preview unavailable' : 'No passport uploaded') +
          '</span></div>';

      var admission = student.admission_number || 'Not recorded';
      var sid = enrolment.sid || enrolment.register_number || '—';

      return `
        <article class="passport-student-card">
          <div class="passport-photo-area">
            ${image}
          </div>

          <div class="passport-student-info">
            <h3>${escapeHtml(passportName(student))}</h3>

            <p>
              <strong>Admission No.:</strong>
              ${escapeHtml(admission)}
            </p>

            <p>
              <strong>Student ID:</strong>
              ${escapeHtml(sid)}
            </p>

            <span class="passport-status ${hasPassport ? 'complete' : 'missing'}">
              ${hasPassport ? 'Passport registered' : 'Passport required'}
            </span>

            <div class="passport-actions">
              <button type="button"
                class="passport-action passport-primary"
                data-passport-action="${hasPassport ? 'replace' : 'upload'}"
                data-student-id="${escapeHtml(student.id)}">
                ${hasPassport ? 'Replace passport' : 'Upload passport'}
              </button>

              ${hasPassport ? `
                <button type="button"
                  class="passport-action passport-danger"
                  data-passport-action="remove"
                  data-student-id="${escapeHtml(student.id)}">
                  Remove passport
                </button>
              ` : ''}
            </div>
          </div>
        </article>
      `;
    }).join('');

    // New filtered results start at the beginning of the register.
    grid.scrollLeft = 0;
    updatePassportScrollButtons();
  }

  async function verifyAdminSession() {
    requireAdmin();

    var sessionResult = await supabaseClient.auth.getSession();

    if (sessionResult.error || !sessionResult.data ||
        !sessionResult.data.session) {
      throw new Error('Your administrator session has expired. Sign in again.');
    }

    var userResult = await supabaseClient.auth.getUser();

    if (userResult.error || !userResult.data || !userResult.data.user ||
        String(userResult.data.user.id) !== String(authenticatedProfile.id)) {
      throw new Error('Administrator session verification failed. Sign in again.');
    }

    var profileResult = await supabaseClient
      .from('profiles')
      .select('id,school_id,role,is_active')
      .eq('id', userResult.data.user.id)
      .maybeSingle();

    if (profileResult.error) throw profileResult.error;

    var profile = profileResult.data;

    if (!profile ||
        String(profile.school_id) !== String(authenticatedProfile.school_id) ||
        String(profile.role || '').toLowerCase() !== 'administrator' ||
        profile.is_active !== true) {
      throw new Error('Administrator authorization could not be verified.');
    }
  }

  async function uploadStudentPassport(studentId, file, isReplacement) {
    if (state.busy) return;

    state.busy = true;

    try {
      await verifyAdminSession();

      if (!file || allowedTypes.indexOf(file.type) === -1) {
        throw new Error('Choose a JPG, PNG, or WebP image.');
      }

      if (file.size > MAX_FILE_SIZE) {
        throw new Error('The image is larger than 5 MB. Choose a smaller image.');
      }

      var item = state.students.find(function (row) {
        return String(row.student.id) === String(studentId);
      });

      if (!item) {
        throw new Error('Student record not found. Refresh and try again.');
      }

      var student = item.student;
      var existing = item.passport;

      if (isReplacement && !existing) {
        throw new Error('The existing passport record changed. Refresh and try again.');
      }

      if (!isReplacement && existing) {
        throw new Error('This student already has a passport. Use Replace passport instead.');
      }

      if (isReplacement) {
        var expectedCode = admissionCode(student.admission_number);

        if (!expectedCode) {
          throw new Error(
            'This student has no valid admission number for confirmation. Update the student record first.'
          );
        }

        var enteredCode = prompt(
          'Confirm passport replacement for ' + passportName(student) +
          '.\nEnter the first character of the admission number and its last three digits.'
        );

        if (enteredCode === null) return;

        if (enteredCode.trim().toUpperCase() !== expectedCode) {
          throw new Error('Confirmation code is incorrect. Passport was not changed.');
        }
      }

      var extension = file.type === 'image/png' ? 'png' :
        file.type === 'image/webp' ? 'webp' : 'jpg';

      var path = String(authenticatedProfile.school_id) + '/' +
        String(student.id) + '/' + Date.now() + '.' + extension;

      passportNotice('Uploading passport photograph…', 'info');

      var uploadResult = await supabaseClient.storage
        .from(BUCKET)
        .upload(path, file, {
          cacheControl: '3600',
          contentType: file.type,
          upsert: false
        });

      if (uploadResult.error) throw uploadResult.error;

      var saveResult = await supabaseClient
        .from('student_passports')
        .upsert({
          school_id: authenticatedProfile.school_id,
          student_id: student.id,
          storage_path: path,
          updated_by: authenticatedProfile.id,
          updated_at: new Date().toISOString()
        }, {
          onConflict: 'school_id,student_id'
        })
        .select('id,student_id,storage_path,updated_at')
        .single();

      if (saveResult.error) {
        await supabaseClient.storage.from(BUCKET).remove([path]);
        throw saveResult.error;
      }

      var oldPath = existing && existing.storage_path;

      if (oldPath && oldPath !== path) {
        var removeOld = await supabaseClient.storage
          .from(BUCKET)
          .remove([oldPath]);

        if (removeOld.error) {
          console.warn(
            'The old passport file could not be cleaned up:',
            removeOld.error.message
          );
        }
      }

      passportNotice('Passport photograph saved successfully.', 'success');

      await loadPassportStudents();
    } catch (error) {
      passportNotice(error.message || 'Passport upload failed.', 'error');
    } finally {
      state.busy = false;
    }
  }

  async function removeStudentPassport(studentId) {
    if (state.busy) return;

    var item = state.students.find(function (row) {
      return String(row.student.id) === String(studentId);
    });

    if (!item || !item.passport) {
      passportNotice('No existing passport record was found.', 'error');
      return;
    }

    var student = item.student;

    if (!confirm(
      'Are you sure you want to remove the existing passport for ' +
      passportName(student) + '?'
    )) return;

    var expectedCode = admissionCode(student.admission_number);

    if (!expectedCode) {
      passportNotice(
        'This student has no valid admission number for confirmation.',
        'error'
      );
      return;
    }

    var enteredCode = prompt(
      'Confirm passport removal for ' + passportName(student) +
      '.\nEnter the first character of the admission number and its last three digits.'
    );

    if (enteredCode === null) return;

    if (enteredCode.trim().toUpperCase() !== expectedCode) {
      passportNotice(
        'Confirmation code is incorrect. Passport was not removed.',
        'error'
      );
      return;
    }

    state.busy = true;

    try {
      await verifyAdminSession();

      var deleteResult = await supabaseClient
        .from('student_passports')
        .delete()
        .eq('school_id', authenticatedProfile.school_id)
        .eq('student_id', student.id)
        .eq('storage_path', item.passport.storage_path);

      if (deleteResult.error) throw deleteResult.error;

      var fileResult = await supabaseClient.storage
        .from(BUCKET)
        .remove([item.passport.storage_path]);

      if (fileResult.error) {
        console.warn(
          'Passport record removed, but file cleanup failed:',
          fileResult.error.message
        );
      }

      passportNotice('Passport registration removed.', 'success');

      await loadPassportStudents();
    } catch (error) {
      passportNotice(error.message || 'Passport removal failed.', 'error');
    } finally {
      state.busy = false;
    }
  }

  // Called by index.html when the administrator opens this tab.
  window.renderPassportRegistration = function () {
    passportStyles();

    try {
      requireAdmin();
      ensureContainer();
      loadPassportRegistration(false);
    } catch (error) {
      var tab = document.getElementById('passportRegistrationTab');

      if (tab) {
        tab.innerHTML =
          '<div class="passport-page">' +
          '<div class="passport-notice error" style="display:block">' +
          escapeHtml(error.message) +
          '</div></div>';
      }
    }
  };
})();
