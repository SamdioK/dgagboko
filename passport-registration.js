
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
        String(authenticatedProfile.role || '').toLowerCase() !== 'admin' ||
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
      #passportRegistrationTab { min-width:0; width:100%; }
      .passport-page { max-width:1200px; margin:0 auto; padding:clamp(10px,2vw,24px); color:#172033; }
      .passport-heading { display:flex; align-items:center; justify-content:space-between; gap:12px; flex-wrap:wrap; margin-bottom:18px; }
      .passport-heading h2 { margin:0 0 5px; font-size:clamp(20px,3vw,28px); }
      .passport-muted { color:#667085; font-size:13px; line-height:1.5; }
      .passport-panel { background:#fff; border:1px solid #e1e7f0; border-radius:14px; padding:16px; margin-bottom:16px; box-shadow:0 3px 12px rgba(20,35,70,.04); min-width:0; }
      .passport-class-grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(min(100%,145px),1fr)); gap:10px; }
      .passport-class-button { display:block; width:100%; min-width:0; text-align:left; border:1px solid #d6dfed; background:#f8faff; border-radius:10px; padding:12px; cursor:pointer; color:#23324c; overflow-wrap:anywhere; }
      .passport-class-button strong { display:block; font-size:14px; }
      .passport-class-button small { display:block; margin-top:4px; color:#667085; }
      .passport-class-button.selected { background:#eaf1ff; border:2px solid #315fc4; padding:11px; color:#173f91; }
      .passport-toolbar { display:flex; align-items:center; gap:10px; flex-wrap:wrap; margin-bottom:14px; }
      .passport-search { flex:1 1 220px; min-width:0; width:100%; box-sizing:border-box; border:1px solid #ccd5e2; border-radius:9px; padding:11px 12px; font-size:15px; }
      .passport-count { font-size:13px; color:#667085; }
      .passport-student-grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(min(100%,245px),1fr)); gap:14px; }
      .passport-student-card { border:1px solid #e0e6ef; border-radius:13px; overflow:hidden; min-width:0; background:#fff; }
      .passport-photo-area { min-height:170px; background:#f2f5fa; display:flex; align-items:center; justify-content:center; padding:12px; }
      .passport-photo { width:120px; height:140px; object-fit:cover; border-radius:8px; border:1px solid #d8dfeb; background:white; }
      .passport-no-photo { width:120px; height:140px; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:8px; text-align:center; border:1px dashed #bac5d6; border-radius:8px; color:#667085; font-size:12px; padding:8px; box-sizing:border-box; }
      .passport-student-info { padding:13px; }
      .passport-student-info h3 { font-size:15px; margin:0 0 7px; overflow-wrap:anywhere; }
      .passport-student-info p { font-size:12px; margin:5px 0; color:#5b6576; overflow-wrap:anywhere; }
      .passport-status { display:inline-block; border-radius:20px; padding:5px 9px; font-size:11px; font-weight:700; margin:3px 0 10px; }
      .passport-status.complete { background:#e3f6e9; color:#176534; }
      .passport-status.missing { background:#fff0d7; color:#855000; }
      .passport-actions { display:flex; flex-wrap:wrap; gap:8px; margin-top:10px; }
      .passport-action { border:0; border-radius:8px; padding:10px 12px; cursor:pointer; font-size:13px; font-weight:600; }
      .passport-action:disabled { opacity:.55; cursor:not-allowed; }
      .passport-primary { background:#2457b8; color:#fff; }
      .passport-danger { background:#fff0f0; color:#a32323; border:1px solid #efc6c6; }
      .passport-notice { display:none; margin:0 0 14px; padding:12px; border-radius:9px; overflow-wrap:anywhere; font-size:14px; }
      .passport-notice.info { background:#edf4ff; color:#214b8f; }
      .passport-notice.success { background:#e7f7ec; color:#176534; }
      .passport-notice.error { background:#fff0f0; color:#9b2525; }
      .passport-empty { padding:26px 12px; text-align:center; color:#667085; border:1px dashed #d5dce7; border-radius:10px; }
      .passport-file-input { display:none; }
      @media(max-width:520px) {
        .passport-page { padding:9px; }
        .passport-panel { padding:12px; }
        .passport-student-grid { grid-template-columns:1fr; }
        .passport-student-card { display:grid; grid-template-columns:112px minmax(0,1fr); }
        .passport-photo-area { min-height:0; padding:8px; }
        .passport-photo { width:94px; height:118px; }
        .passport-no-photo { width:94px; height:118px; }
        .passport-student-info { padding:10px; }
        .passport-actions { flex-direction:column; }
        .passport-action { width:100%; }
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
          <button type="button" class="passport-action passport-primary"
            id="passportRefreshBtn">Refresh records</button>
        </div>

        <div id="passportNotice" class="passport-notice"
          role="status" aria-live="polite"></div>

        <section class="passport-panel">
          <h3 style="margin:0 0 5px;font-size:16px;">Select class and arm</h3>
          <p class="passport-muted" style="margin:0 0 13px;">
            Choose the student's current class to display its official register.
          </p>
          <div id="passportClassGrid" class="passport-class-grid">
            <div class="passport-empty">Loading classes…</div>
          </div>
        </section>

        <section class="passport-panel">
          <div class="passport-toolbar">
            <input id="passportStudentSearch" class="passport-search"
              type="search" placeholder="Search student name, SID or admission number"
              aria-label="Search students">
            <span id="passportStudentCount" class="passport-count"></span>
          </div>
          <div id="passportStudentGrid" class="passport-student-grid">
            <div class="passport-empty">Select a class to view students.</div>
          </div>
        </section>
      </div>

      <input id="passportUploadInput" class="passport-file-input"
        type="file" accept="image/jpeg,image/png,image/webp">
    `;

    document.getElementById('passportRefreshBtn').onclick = function () {
      loadPassportRegistration(true);
    };

    document.getElementById('passportStudentSearch').oninput = function () {
      state.search = this.value.trim().toLowerCase();
      renderPassportStudents();
    };

    document.getElementById('passportClassGrid').onclick = function (event) {
      var button = event.target.closest('[data-passport-class]');
      if (!button) return;

      state.selectedClassId = button.getAttribute('data-passport-class');
      renderPassportClasses();
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
      if (showMessage) passportNotice('Passport records refreshed.', 'success');
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
      grid.innerHTML = '<div class="passport-empty">No classes were found for this school.</div>';
      return;
    }

    var groups = {};
    state.classes.forEach(function (item) {
      var level = classLevel(item.class_name);
      if (!groups[level]) groups[level] = [];
      groups[level].push(item);
    });

    var order = ['BASIC 7', 'BASIC 8', 'BASIC 9', 'SS 1', 'SS 2', 'SS 3', 'Other classes'];

    grid.innerHTML = order.filter(function (level) {
      return groups[level] && groups[level].length;
    }).map(function (level) {
      return groups[level].map(function (item) {
        var selected = String(item.id) === String(state.selectedClassId);
        return `
          <button type="button"
            class="passport-class-button ${selected ? 'selected' : ''}"
            data-passport-class="${escapeHtml(item.id)}"
            aria-pressed="${selected}">
            <strong>${escapeHtml(item.class_name)}</strong>
            <small>${selected ? 'Selected class' : 'Select class / arm'}</small>
          </button>
        `;
      }).join('');
    }).join('');
  }

  async function loadPassportStudents() {
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
        .eq('class_id', state.selectedClassId)
        .order('register_number');

      if (enrolmentResult.error) throw enrolmentResult.error;

      var enrolments = enrolmentResult.data || [];
      var studentIds = enrolments.map(function (row) {
        return row.student_id;
      }).filter(Boolean);

      if (!studentIds.length) {
        state.students = [];
        renderPassportStudents();
        passportNotice('There are no enrolled students in this class for the active session.', 'info');
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

      state.students = [];

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

          if (!signed.error && signed.data) imageUrl = signed.data.signedUrl;
        }

        state.students.push({
          student: student,
          enrolment: enrolment,
          passport: passport,
          imageUrl: imageUrl
        });
      }

      renderPassportStudents();
      passportNotice('Class register loaded successfully.', 'success');
    } catch (error) {
      state.students = [];
      renderPassportStudents();
      passportNotice(error.message || 'Could not load the class register.', 'error');
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

    count.textContent = filtered.length + ' of ' + state.students.length + ' students';

    if (!state.selectedClassId) {
      grid.innerHTML = '<div class="passport-empty">Select a class or arm above to begin.</div>';
      return;
    }

    if (!filtered.length) {
      grid.innerHTML = '<div class="passport-empty">No students match your search in this class.</div>';
      return;
    }

    grid.innerHTML = filtered.map(function (item) {
      var student = item.student;
      var enrolment = item.enrolment;
      var passport = item.passport;
      var hasPassport = !!(passport && passport.storage_path);
      var image = item.imageUrl
        ? '<img class="passport-photo" src="' + escapeHtml(item.imageUrl) +
          '" alt="Passport photograph of ' + escapeHtml(passportName(student)) + '">'
        : '<div class="passport-no-photo"><span style="font-size:25px">👤</span><span>' +
          (hasPassport ? 'Preview unavailable' : 'No passport uploaded') + '</span></div>';

      var admission = student.admission_number || 'Not recorded';
      var sid = enrolment.sid || enrolment.register_number || '—';

      return `
        <article class="passport-student-card">
          <div class="passport-photo-area">${image}</div>
          <div class="passport-student-info">
            <h3>${escapeHtml(passportName(student))}</h3>
            <p><strong>Admission No.:</strong> ${escapeHtml(admission)}</p>
            <p><strong>Student ID:</strong> ${escapeHtml(sid)}</p>
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
                </button>` : ''}
            </div>
          </div>
        </article>
      `;
    }).join('');
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
        String(profile.role || '').toLowerCase() !== 'admin' ||
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

      if (!item) throw new Error('Student record not found. Refresh and try again.');

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
          throw new Error('This student has no valid admission number for confirmation. Update the student record first.');
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
        var removeOld = await supabaseClient.storage.from(BUCKET).remove([oldPath]);
        if (removeOld.error) {
          console.warn('The old passport file could not be cleaned up:', removeOld.error.message);
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
      passportNotice('This student has no valid admission number for confirmation.', 'error');
      return;
    }

    var enteredCode = prompt(
      'Confirm passport removal for ' + passportName(student) +
      '.\nEnter the first character of the admission number and its last three digits.'
    );

    if (enteredCode === null) return;

    if (enteredCode.trim().toUpperCase() !== expectedCode) {
      passportNotice('Confirmation code is incorrect. Passport was not removed.', 'error');
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
        console.warn('Passport record removed, but file cleanup failed:', fileResult.error.message);
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
        tab.innerHTML = '<div class="passport-page"><div class="passport-notice error" style="display:block">' +
          escapeHtml(error.message) + '</div></div>';
      }
    }
  };
})();
