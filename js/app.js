import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
        import { getAuth, GoogleAuthProvider, signInWithPopup, signInWithRedirect, getRedirectResult, signOut, onAuthStateChanged, setPersistence, browserLocalPersistence } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
        import { getFirestore, doc, getDoc, getDocs, addDoc, setDoc, updateDoc, deleteDoc, onSnapshot, collection, query, where, orderBy, limit, writeBatch } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
        import { setLogLevel } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
        
        // setLogLevel('Debug'); // Enable debug logging for Firestore

        let db;
        let auth;
        let userId = null;

        // --- Session Persistence & Listener Management ---
        let unsubscribeExercises = null;  // Unsubscribe function for exercises listener
        let unsubscribeSessionLogs = null; // Unsubscribe function for logs listener
        let isListenersSetup = false;      // Flag to prevent duplicate listener setup
        let isFirebaseInitialized = false; // Flag to prevent duplicate initialization
        // ------------------------------------

        // --- Setup Variables for Local Development ---
        // The firebaseConfig object is now loaded from js/config.js

        // For local testing, we will ignore the token and app ID from the canvas.
        const initialAuthToken = null;
        // ------------------------------------

        // --- Utility Functions ---

        /**
         * Generates the correct Firestore path for the user's private data.
         * For local development, this is simplified.
         * @param {string} collectionName - The name of the collection (e.g., 'exercises' or 'logs').
         * @returns {string} The full Firestore path.
         */
        function getPrivateCollectionPath(collectionName) {
            if (!userId) {
                console.error("Attempted to access Firestore before user is authenticated.");
                return null;
            }
            // Simplified path for local development: /users/{userId}/{collectionName}
            return `users/${userId}/${collectionName}`;
        }

        // --- App State and Logic ---

        let exercises = [];
        let sessionLogs = [];
        let currentExerciseId = null;

        // --- Multiple Workouts Support ---
        let workouts = [];                    // Array of user's workouts
        let currentWorkoutId = null;          // Currently selected workout
        let unsubscribeWorkouts = null;       // Unsubscribe function for workouts listener
        // ------------------------------------

        // --- Dashboard Logic ---

        function getStartOfWeek() {
            const now = new Date();
            const day = now.getDay(); // 0 (Sun) to 6 (Sat)
            const diff = now.getDate() - day + (day === 0 ? -6 : 1); // Adjust when day is Sunday
            const monday = new Date(now);
            monday.setDate(diff);
            monday.setHours(0, 0, 0, 0);
            return monday;
        }

        function renderWeeklyActivity() {
            const container = document.getElementById('weekly-activity-content');
            if (!container) return;

            const startOfWeek = getStartOfWeek();
            const weeklyLogs = sessionLogs.filter(log => log.Date.toDate() >= startOfWeek);

            if (weeklyLogs.length === 0) {
                container.innerHTML = '<p class="text-gray-500 dark:text-gray-400 italic text-center">New week, let\'s hit the gym!</p>';
                return;
            }

            // Summarize: Group by day
            const activityByDay = {};
            // Sort logs by date ascending for the summary
            weeklyLogs.sort((a, b) => a.Date.toDate() - b.Date.toDate());

            weeklyLogs.forEach(log => {
                const date = log.Date.toDate().toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
                if (!activityByDay[date]) activityByDay[date] = 0;
                activityByDay[date]++; // Count sets
            });

            let html = '<ul class="space-y-2">';
            for (const [day, count] of Object.entries(activityByDay)) {
                html += `
                    <li onclick="switchTab('history-tab')" class="flex justify-between items-center p-3 bg-gray-50 dark:bg-gray-600 rounded-lg cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-500 transition-colors">
                        <span class="font-medium text-gray-700 dark:text-gray-200">${day}</span>
                        <span class="text-sm text-cyan-600 dark:text-cyan-400 font-bold">${count} Sets Logged</span>
                    </li>
                `;
            }
            html += '</ul>';
            container.innerHTML = html;
        }

        /**
         * Renders the list of exercises in the My Program tab, grouped by sections.
         */
        function renderExercises() {
            const container = document.getElementById('exercise-list');
            if (!container) return;

            container.innerHTML = '';

            // Filter exercises for current workout
            const filteredExercises = exercises.filter(ex => ex.workoutId === currentWorkoutId);

            if (filteredExercises.length === 0) {
                container.innerHTML = '<p class="text-gray-500 dark:text-gray-400 text-center mt-8">No exercises added yet.</p>';
                return;
            }

            // Get the current workout to access sections
            const currentWorkout = workouts.find(w => w.id === currentWorkoutId);
            if (!currentWorkout || !currentWorkout.sections) {
                container.innerHTML = '<p class="text-gray-500 dark:text-gray-400 text-center mt-8">Workout not found.</p>';
                return;
            }

            // Group exercises by section
            const groupedBySection = {};
            currentWorkout.sections.forEach(section => {
                groupedBySection[section.id] = [];
            });

            filteredExercises.forEach(exercise => {
                if (groupedBySection[exercise.sectionId]) {
                    groupedBySection[exercise.sectionId].push(exercise);
                }
            });

            // Render sections and exercises
            currentWorkout.sections.forEach(section => {
                const sectionExercises = groupedBySection[section.id] || [];

                // Create section header
                const sectionHeader = document.createElement('div');
                sectionHeader.className = 'mt-6 mb-3';
                sectionHeader.innerHTML = `
                    <h3 class="text-sm font-bold text-gray-700 dark:text-gray-300 uppercase tracking-widest">${section.name}</h3>
                `;
                container.appendChild(sectionHeader);

                // Create section container for sortable
                const sectionContainer = document.createElement('div');
                sectionContainer.className = 'section-container mb-4';
                sectionContainer.setAttribute('data-section-id', section.id);

                // Render exercises in this section
                sectionExercises.forEach((exercise) => {
                    const card = document.createElement('div');
                    card.className = `card bg-white dark:bg-gray-700 p-4 rounded-xl shadow-lg border-l-4 border-cyan-500 dark:border-cyan-400 mb-4 cursor-move`;
                    card.setAttribute('data-id', exercise.Exercise_ID);

                    card.innerHTML = `
                        <div class="flex justify-between items-center">
                            <div class="flex-grow" onclick="handleEditExercise('${exercise.Exercise_ID}')">
                                <div class="flex justify-between items-start mb-1">
                                    <h3 class="text-lg font-bold text-gray-800 dark:text-gray-100">${exercise.Name}</h3>
                                    <span class="bg-gray-200 dark:bg-gray-600 text-gray-600 dark:text-gray-300 text-[10px] px-2 py-0.5 rounded-md font-medium uppercase tracking-wider mr-2 text-center min-w-[60px]">${exercise.Focus_Area || 'General'}</span>
                                </div>
                                <p class="text-sm text-gray-500 dark:text-gray-400 line-clamp-2">${exercise.Physio_Notes || 'No notes available.'}</p>
                            </div>
                        </div>
                    `;
                    sectionContainer.appendChild(card);
                });

                container.appendChild(sectionContainer);
            });

            // Initialize Sortable for each section
            if (window.sortableInstances) {
                window.sortableInstances.forEach(instance => instance.destroy());
            }
            window.sortableInstances = [];

            const sectionContainers = container.querySelectorAll('.section-container');
            sectionContainers.forEach(sectionContainer => {
                const sortable = new Sortable(sectionContainer, {
                    animation: 150,
                    handle: '.card',
                    delay: 100,
                    onEnd: async function (evt) {
                        const newIndex = evt.newIndex;
                        const oldIndex = evt.oldIndex;

                        if (newIndex === oldIndex) return;

                        const sectionId = sectionContainer.getAttribute('data-section-id');
                        const sectionExercises = filteredExercises.filter(ex => ex.sectionId === sectionId);

                        // Reorder exercises within this section
                        const movedExercise = sectionExercises.splice(oldIndex, 1)[0];
                        sectionExercises.splice(newIndex, 0, movedExercise);

                        // Update Firestore with new order
                        try {
                            const batch = writeBatch(db);
                            const exercisesPath = getPrivateCollectionPath('exercises');

                            sectionExercises.forEach((ex, index) => {
                                const ref = doc(db, exercisesPath, ex.Exercise_ID);
                                batch.update(ref, { order: index });
                            });

                            await batch.commit();
                        } catch (error) {
                            console.error("Error saving order:", error);
                            showMessage("Failed to save new order.", "error");
                        }
                    }
                });
                window.sortableInstances.push(sortable);
            });
        }
        
        /**
         * Global handler to open edit form from HTML onclick
         * @param {string} exerciseId 
         */
        function handleEditExercise(exerciseId) {
            console.log(`=== Edit Exercise CTA: ${exerciseId} ===`);
            const exercise = exercises.find(e => e.Exercise_ID === exerciseId);
            if (exercise) {
                console.log("Opening exercise for edit:", exercise.Name);
                openAddExerciseForm(exercise);
            } else {
                console.error(`Exercise not found: ${exerciseId}`);
            }
        }
        window.handleEditExercise = handleEditExercise;

        /**
         * Renders the last 5 logs for the current exercise.
         * @param {string} exerciseId - The ID of the exercise.
         */
        function renderRelatedLogs(exerciseId) {
            const logsContainer = document.getElementById('detail-log-history');
            if (!logsContainer) return;

            const relatedLogs = sessionLogs
                .filter(log => log.Exercise_ID === exerciseId)
                .sort((a, b) => b.Date.toDate() - a.Date.toDate());

            if (relatedLogs.length === 0) {
                logsContainer.innerHTML = '<p class="text-gray-500 dark:text-gray-400">No session history logged yet.</p>';
                return;
            }

            // Group logs by workout session
            const sessions = relatedLogs.reduce((acc, log) => {
                const sessionTime = log.Date.toDate().getTime();
                if (!acc[sessionTime]) {
                    acc[sessionTime] = { date: log.Date.toDate(), logs: [] };
                }
                acc[sessionTime].logs.push(log);
                return acc;
            }, {});

            const last5Sessions = Object.values(sessions).slice(0, 5);

            logsContainer.innerHTML = last5Sessions.map(session => {
                 const dateStr = session.date.toLocaleDateString();
                 const timeStr = session.date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                 const sets = session.logs.sort((a, b) => a.SetNumber - b.SetNumber);

                 return `
                    <div class="bg-gray-100 dark:bg-gray-700 p-3 rounded-lg border border-gray-200 dark:border-gray-600 mb-3">
                        <div class="flex justify-between text-sm font-medium text-gray-800 dark:text-gray-200 mb-2">
                            <span>${dateStr} @ ${timeStr}</span>
                        </div>
                        <ul class="text-sm text-gray-600 dark:text-gray-300 space-y-1 pl-1">
                        ${sets.map(set => {
                            let metricsStr = '';
                            if (set.RPE) metricsStr += `RPE: ${set.RPE}`;
                            if (set.Pain) metricsStr += (metricsStr ? ' • ' : '') + `Pain: ${set.Pain}`;
                            return `
                            <li class="flex justify-between">
                                <span>
                                    <strong>Set ${set.SetNumber}:</strong> ${set.Actual_Reps}
                                    <span class="text-gray-500 dark:text-gray-400">@ ${set.Weight_Used || '0'}</span>
                                    ${set.Variation ? `<span class="text-cyan-600 dark:text-cyan-400">(${set.Variation})</span>` : ''}
                                </span>
                                ${metricsStr ? `<span class="text-yellow-600 dark:text-yellow-400">${metricsStr}</span>` : ''}
                            </li>
                        `}).join('')}
                        </ul>
                    </div>
                 `;
            }).join('');
        }

        /**
         * Switches the main view tab.
         * @param {string} tabId - The ID of the tab content to show.
         */
        function switchTab(tabId) {
            console.log(`=== Switch Tab CTA: ${tabId} ===`);
            // Hide all tab content
            document.querySelectorAll('.tab-content').forEach(content => content.style.display = 'none');
            // Show the selected tab content
            const activeContent = document.getElementById(tabId);
            if (activeContent) {
                activeContent.style.display = 'block';
                console.log(`Tab ${tabId} displayed successfully`);
            } else {
                console.warn(`Tab ${tabId} not found in DOM`);
            }

            // Update active tab styles
            document.querySelectorAll('.tab-header button').forEach(button => {
                button.classList.remove('active-tab');
            });
            const activeHeader = document.querySelector(`button[onclick="switchTab('${tabId}')"]`);
            if (activeHeader) activeHeader.classList.add('active-tab');
        }
        
        // Expose function globally for HTML elements
        window.switchTab = switchTab;

        /**
         * Populates the Log Form with the selected exercise details and switches view.
         */
        function openLogForm() {
            console.log("=== Open Log Form CTA ===");
            if (!currentExerciseId) {
                console.warn("No exercise selected when opening log form");
                showMessage("Please select an exercise first.", 'error');
                return;
            }
            console.log(`Loading exercise: ${currentExerciseId}`);
            const exercise = exercises.find(e => e.Exercise_ID === currentExerciseId);
            if (!exercise) {
                console.error(`Exercise not found: ${currentExerciseId}`);
                return;
            }
            console.log("Exercise loaded:", exercise.Name);

            document.getElementById('log-exercise-name').textContent = exercise.Name;
            document.getElementById('log-form').reset();
            
            // Set initial defaults/hints based on the master exercise
            document.getElementById('log-actual-sets').placeholder = `Target: ${exercise.Target_Sets}`;
            document.getElementById('log-actual-reps').placeholder = `Target: ${exercise.Target_Reps}`;
            document.getElementById('log-weight-used').value = exercise.Weight_Used_Initial || '';
            
            window.switchTab('log-form-tab');
        }
        
        // Expose function globally for HTML elements
        window.openLogForm = openLogForm;

        /**
         * Handles the deletion of the currently viewed exercise and all its logs.
         */
        async function handleDeleteExercise() {
            console.log(`=== Delete Exercise CTA: ${currentExerciseId} ===`);
            if (!currentExerciseId) {
                console.warn("No exercise selected when trying to delete");
                showMessage("No exercise selected.", 'error');
                return;
            }

            const exerciseToDelete = exercises.find(e => e.Exercise_ID === currentExerciseId);
            if (!exerciseToDelete) {
                showMessage("Could not find the exercise to delete.", 'error');
                return;
            }

            if (confirm(`Are you sure you want to permanently delete "${exerciseToDelete.Name}" and all of its logged history? This cannot be undone.`)) {
                try {
                    const batch = writeBatch(db);

                    // 1. Find and delete all related logs
                    const logsPath = getPrivateCollectionPath('logs');
                    const q = query(collection(db, logsPath), where("Exercise_ID", "==", currentExerciseId));
                    const logsSnapshot = await getDocs(q);
                    logsSnapshot.forEach(logDoc => {
                        batch.delete(logDoc.ref);
                    });

                    // 2. Delete the main exercise document
                    const exerciseDocRef = doc(db, getPrivateCollectionPath('exercises'), currentExerciseId);
                    batch.delete(exerciseDocRef);

                    // 3. Commit the batch
                    await batch.commit();

                    showMessage(`"${exerciseToDelete.Name}" was deleted.`, 'success');
                    window.switchTab('my-program');

                } catch (error) {
                    console.error("Error deleting exercise: ", error);
                    showMessage("Failed to delete exercise. Check console.", 'error');
                }
            }
        }
        // Expose globally
        window.handleDeleteExercise = handleDeleteExercise;

        /**
         * Handles the submission of the workout log form.
         * @param {Event} event - The form submit event.
         */
        async function handleLogSubmission(event) {
            event.preventDefault();
            
            if (!userId) {
                showMessage("App not fully authenticated. Please wait a moment and try again.", 'error');
                return;
            }
            if (!currentExerciseId) {
                 showMessage("Error: No exercise selected.", 'error');
                 return;
            }

            const form = event.target;
            const logData = {
                Exercise_ID: currentExerciseId,
                Date: new Date(),
                Variation: form['Variation'].value.trim(), // Add variation
                Actual_Sets: parseInt(form['Actual_Sets'].value, 10),
                Actual_Reps: form['Actual_Reps'].value.trim(),
                Weight_Used: form['Weight_Used'].value.trim(),
                Subjective_Feeling: parseInt(form['Subjective_Feeling'].value, 10),
                Pain_Level: parseInt(form['Pain_Level'].value, 10),
                Comments: form['Comments'].value.trim(),
            };
            
            if (isNaN(logData.Actual_Sets) || logData.Actual_Sets <= 0) {
                showMessage("Please enter a valid number of sets.", 'error');
                return;
            }
            if (!logData.Actual_Reps) {
                showMessage("Please enter the reps/duration performed.", 'error');
                return;
            }

            try {
                const logsCollectionRef = collection(db, getPrivateCollectionPath('logs'));
                await addDoc(logsCollectionRef, logData);

                showMessage("Workout logged successfully!", 'success');
                form.reset();
                // After logging, switch back to the main program view (which will refresh logs)
                window.switchTab('my-program'); 
            } catch (error) {
                console.error("Error writing document: ", error);
                showMessage("Failed to log workout. Check console for details.", 'error');
            }
        }

        /**
         * Displays a temporary message box to the user.
         * @param {string} message - The message content.
         * @param {string} type - 'success' or 'error'.
         */
        function showMessage(message, type) {
            const box = document.getElementById('message-box');
            box.textContent = message;
            box.className = 'fixed bottom-20 left-1/2 transform -translate-x-1/2 p-3 rounded-xl shadow-2xl z-50 transition-all duration-300';
            
            if (type === 'success') {
                box.classList.add('bg-green-500', 'text-white');
            } else if (type === 'error') {
                box.classList.add('bg-red-500', 'text-white');
            }
            
            box.style.opacity = '1';

            setTimeout(() => {
                box.style.opacity = '0';
            }, 3000);
        }

        /**
         * Switches view to the Add/Edit Exercise form.
         */
        function openAddExerciseForm(exerciseToEdit = null) {
            console.log(`=== Open Add/Edit Exercise CTA ===`, exerciseToEdit ? `Editing: ${exerciseToEdit.Exercise_ID}` : "Creating new");
            const form = document.getElementById('add-exercise-form');
            const title = document.querySelector('#add-exercise-tab h2');
            const submitBtn = form.querySelector('button[type="submit"]');
            const sectionSelect = form['Section'];

            form.reset();

            // Populate section dropdown with current workout's sections
            const currentWorkout = workouts.find(w => w.id === currentWorkoutId);
            sectionSelect.innerHTML = '<option value="">-- Select a section --</option>';

            if (currentWorkout && currentWorkout.sections) {
                currentWorkout.sections.forEach(section => {
                    const option = document.createElement('option');
                    option.value = section.id;
                    option.textContent = section.name;
                    sectionSelect.appendChild(option);
                });
                // Default to first section
                if (currentWorkout.sections.length > 0) {
                    sectionSelect.value = currentWorkout.sections[0].id;
                }
            }

            if (exerciseToEdit) {
                // Edit Mode
                currentExerciseId = exerciseToEdit.Exercise_ID; // Track ID for deletion/updates
                form.setAttribute('data-edit-id', exerciseToEdit.Exercise_ID);
                title.textContent = "Edit Exercise";
                submitBtn.textContent = "Update Exercise";

                // Populate fields
                form['Name'].value = exerciseToEdit.Name || '';
                form['Focus_Area'].value = exerciseToEdit.Focus_Area || '';
                form['Section'].value = exerciseToEdit.sectionId || '';
                form['Target_Sets'].value = exerciseToEdit.Target_Sets || '';
                form['Target_Reps'].value = exerciseToEdit.Target_Reps || '';
                form['Weight_Used_Initial'].value = exerciseToEdit.Weight_Used_Initial || '';
                form['Video_Link'].value = exerciseToEdit.Video_Link || '';
                form['Physio_Notes'].value = exerciseToEdit.Physio_Notes || '';

                // Add Delete Button dynamically if editing
                if (!document.getElementById('delete-exercise-btn')) {
                    const deleteBtn = document.createElement('button');
                    deleteBtn.id = 'delete-exercise-btn';
                    deleteBtn.type = 'button';
                    deleteBtn.className = 'w-full mt-4 bg-red-100 hover:bg-red-200 text-red-600 dark:bg-red-900 dark:text-red-200 dark:hover:bg-red-800 font-bold py-3 rounded-xl transition-colors';
                    deleteBtn.textContent = 'Delete Exercise';
                    // Use addEventListener for better compatibility (especially Safari)
                    deleteBtn.addEventListener('click', (e) => {
                        e.preventDefault();
                        handleDeleteExercise();
                    });
                    form.appendChild(deleteBtn);
                }
            } else {
                // Add Mode
                currentExerciseId = null;
                form.removeAttribute('data-edit-id');
                title.textContent = "Create New Exercise";
                submitBtn.textContent = "Save Exercise";

                // Remove delete button if present
                const deleteBtn = document.getElementById('delete-exercise-btn');
                if (deleteBtn) deleteBtn.remove();
            }

            window.switchTab('add-exercise-tab');
        }
        // Expose globally
        window.openAddExerciseForm = openAddExerciseForm;

        /**
         * Opens the new workout creation form.
         */
        function openNewWorkoutForm() {
            console.log("=== Open New Workout CTA ===");
            const form = document.getElementById('new-workout-form');
            if (form) {
                form.reset();
                console.log("New workout form reset");
            } else {
                console.warn("New workout form not found");
            }
            window.switchTab('new-workout-tab');
        }
        window.openNewWorkoutForm = openNewWorkoutForm;

        /**
         * Handles the submission of the new workout form.
         * @param {Event} event - The form submit event.
         */
        async function handleNewWorkoutSubmission(event) {
            event.preventDefault();

            if (!userId) {
                showMessage("Authentication error. Please reload.", 'error');
                return;
            }

            const form = event.target;
            const workoutName = form['WorkoutName'].value.trim();
            const description = form['Description'].value.trim();

            if (!workoutName) {
                showMessage("Workout name is required.", 'error');
                return;
            }

            try {
                const workoutData = {
                    name: workoutName,
                    description: description,
                    order: workouts.length, // Add to end
                    sections: [
                        { id: `section-${Date.now()}`, name: 'Exercises', order: 0 }
                    ]
                };

                const workoutsPath = getPrivateCollectionPath('workouts');
                const docRef = await addDoc(collection(db, workoutsPath), workoutData);
                console.log("New workout created with ID:", docRef.id);

                showMessage(`"${workoutName}" workout created successfully!`, 'success');
                form.reset();
                window.switchTab('my-program');
            } catch (error) {
                console.error("Error creating workout:", error);
                showMessage("Failed to create workout. Check console.", 'error');
            }
        }
        window.handleNewWorkoutSubmission = handleNewWorkoutSubmission;

        /**
         * Opens the edit workout form for the current workout.
         */
        function openEditWorkoutForm() {
            if (!currentWorkoutId) {
                showMessage("No workout selected.", 'error');
                return;
            }

            const currentWorkout = workouts.find(w => w.id === currentWorkoutId);
            if (!currentWorkout) {
                showMessage("Workout not found.", 'error');
                return;
            }

            const form = document.getElementById('edit-workout-form');
            form.reset();

            // Populate fields
            document.getElementById('edit-workout-name').value = currentWorkout.name || '';
            document.getElementById('edit-workout-description').value = currentWorkout.description || '';

            // Store current workout ID for submission
            form.setAttribute('data-workout-id', currentWorkoutId);

            // Render sections
            renderSectionsList();

            window.switchTab('edit-workout-tab');
        }
        window.openEditWorkoutForm = openEditWorkoutForm;

        /**
         * Renders the sections list in the edit workout form.
         */
        function renderSectionsList() {
            const container = document.getElementById('sections-list');
            if (!container) return;

            const currentWorkout = workouts.find(w => w.id === currentWorkoutId);
            if (!currentWorkout || !currentWorkout.sections) {
                container.innerHTML = '<p class="text-gray-500 dark:text-gray-400 text-sm">No sections.</p>';
                return;
            }

            container.innerHTML = '';

            currentWorkout.sections.forEach((section, index) => {
                const sectionDiv = document.createElement('div');
                sectionDiv.className = 'flex items-center justify-between p-3 bg-gray-100 dark:bg-gray-700 rounded-lg';
                sectionDiv.setAttribute('data-section-id', section.id);

                sectionDiv.innerHTML = `
                    <div class="flex-1">
                        <input type="text" class="section-name-input block w-full rounded-md bg-white dark:bg-gray-600 border border-gray-300 dark:border-gray-500 p-2 text-sm" value="${section.name}" onchange="handleRenameSection('${currentWorkoutId}', '${section.id}', this.value)">
                    </div>
                    <button type="button" class="ml-2 text-red-500 hover:text-red-700 font-bold" onclick="handleDeleteSection('${currentWorkoutId}', '${section.id}')">
                        ✕
                    </button>
                `;

                container.appendChild(sectionDiv);
            });
        }
        window.renderSectionsList = renderSectionsList;

        /**
         * Handles adding a new section to the current workout.
         */
        function handleAddSection() {
            console.log("=== Add Section CTA ===");
            const currentWorkout = workouts.find(w => w.id === currentWorkoutId);
            if (!currentWorkout) {
                console.error(`Current workout not found: ${currentWorkoutId}`);
                return;
            }

            const sectionName = prompt("Enter section name:", "New Section");
            if (!sectionName || sectionName.trim() === "") {
                console.log("Section name cancelled or empty");
                return;
            }
            console.log("Creating new section:", sectionName);

            const newSection = {
                id: `section-${Date.now()}`,
                name: sectionName.trim(),
                order: currentWorkout.sections.length
            };

            currentWorkout.sections.push(newSection);
            renderSectionsList();
        }
        window.handleAddSection = handleAddSection;

        /**
         * Handles renaming a section.
         */
        function handleRenameSection(workoutId, sectionId, newName) {
            if (!newName || newName.trim() === "") {
                showMessage("Section name cannot be empty.", 'error');
                renderSectionsList();
                return;
            }

            const workout = workouts.find(w => w.id === workoutId);
            if (!workout) return;

            const section = workout.sections.find(s => s.id === sectionId);
            if (section) {
                section.name = newName.trim();
            }
        }
        window.handleRenameSection = handleRenameSection;

        /**
         * Handles deleting a section from a workout.
         */
        function handleDeleteSection(workoutId, sectionId) {
            const workout = workouts.find(w => w.id === workoutId);
            if (!workout) return;

            const section = workout.sections.find(s => s.id === sectionId);
            if (!section) return;

            if (confirm(`Delete section "${section.name}"? Any exercises in this section will not be deleted, but will lose their section assignment.`)) {
                workout.sections = workout.sections.filter(s => s.id !== sectionId);
                renderSectionsList();
            }
        }
        window.handleDeleteSection = handleDeleteSection;

        /**
         * Handles the submission of the edit workout form.
         */
        async function handleEditWorkoutSubmission(event) {
            event.preventDefault();

            if (!userId) {
                showMessage("Authentication error. Please reload.", 'error');
                return;
            }

            const form = event.target;
            const workoutId = form.getAttribute('data-workout-id');
            const workoutName = document.getElementById('edit-workout-name').value.trim();
            const description = document.getElementById('edit-workout-description').value.trim();

            if (!workoutName) {
                showMessage("Workout name is required.", 'error');
                return;
            }

            const currentWorkout = workouts.find(w => w.id === workoutId);
            if (!currentWorkout) {
                showMessage("Workout not found.", 'error');
                return;
            }

            if (currentWorkout.sections.length === 0) {
                showMessage("Workout must have at least one section.", 'error');
                return;
            }

            try {
                const workoutData = {
                    name: workoutName,
                    description: description,
                    sections: currentWorkout.sections
                };

                const workoutsPath = getPrivateCollectionPath('workouts');
                const docRef = doc(db, workoutsPath, workoutId);
                await updateDoc(docRef, workoutData);

                showMessage(`"${workoutName}" updated successfully!`, 'success');
                window.switchTab('my-program');
            } catch (error) {
                console.error("Error updating workout:", error);
                showMessage("Failed to update workout. Check console.", 'error');
            }
        }
        window.handleEditWorkoutSubmission = handleEditWorkoutSubmission;

        // ...

        /**
         * Handles the submission of the new exercise form.
         * @param {Event} event - The form submit event.
         */
        async function handleAddExerciseSubmission(event) {
            event.preventDefault();

            if (!userId) {
                showMessage("Authentication error. Please reload.", 'error');
                return;
            }

            const form = event.target;
            const editId = form.getAttribute('data-edit-id');

            const exerciseData = {
                Name: form['Name'].value.trim(),
                Focus_Area: form['Focus_Area'].value.trim(),
                sectionId: form['Section'].value.trim(),
                workoutId: currentWorkoutId,
                Target_Sets: parseInt(form['Target_Sets'].value, 10),
                Target_Reps: form['Target_Reps'].value.trim(),
                Weight_Used_Initial: form['Weight_Used_Initial'].value.trim(),
                Video_Link: form['Video_Link'].value.trim(),
                Physio_Notes: form['Physio_Notes'].value.trim(),
            };

            if (!exerciseData.sectionId) {
                showMessage("Please select a section.", 'error');
                return;
            }

            // Only set order for new items to avoid overwriting existing order on edit
            if (!editId) {
                exerciseData.order = new Date().getTime();
            }

            if (!exerciseData.Name || !exerciseData.Focus_Area) {
                showMessage("Exercise Name and Focus Area are required.", 'error');
                return;
            }
            if (isNaN(exerciseData.Target_Sets) || exerciseData.Target_Sets <= 0) {
                showMessage("Please enter valid Target Sets.", 'error');
                return;
            }

            try {
                const exercisesPath = getPrivateCollectionPath('exercises');

                if (editId) {
                    // Update existing
                    const docRef = doc(db, exercisesPath, editId);
                    await updateDoc(docRef, exerciseData);
                    showMessage("Exercise updated successfully!", 'success');
                } else {
                    // Create new
                    const collectionRef = collection(db, exercisesPath);
                    await addDoc(collectionRef, exerciseData);
                    showMessage("Exercise added successfully!", 'success');
                }

                form.reset();
                window.switchTab('my-program');
            } catch (error) {
                console.error("Error saving exercise: ", error);
                showMessage("Failed to save exercise. Check console.", 'error');
            }
        }

        // --- Firebase Authentication and Initialization ---

        /**
         * Initiates the Google Sign-In popup flow.
         */
        function isMobileBrowser() {
            return /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
        }

        function signInWithGoogle() {
            console.log("=== Sign In CTA clicked ===");
            if (!auth) {
                console.error("Auth not initialized when signing in");
                showMessage("Firebase not initialized. Please refresh the page.", 'error');
                return;
            }

            const provider = new GoogleAuthProvider();

            if (isMobileBrowser()) {
                console.log("Mobile detected — using redirect sign-in");
                signInWithRedirect(auth, provider).catch((error) => {
                    console.error("Google Sign-In Redirect Error:", error.code, error.message);
                    showMessage(`Sign-in failed: ${error.message}`, 'error');
                });
            } else {
                console.log("Desktop detected — using popup sign-in");
                signInWithPopup(auth, provider)
                    .then((result) => {
                        console.log("Sign-in successful for:", result.user.displayName);
                    }).catch((error) => {
                        console.error("Google Sign-In Error:", error.code, error.message);

                        let userMessage = error.message;
                        if (error.code === 'auth/popup-blocked') {
                            userMessage = "Sign-in popup was blocked. Please allow popups and try again.";
                        } else if (error.code === 'auth/cancelled-popup-request') {
                            userMessage = "Sign-in was cancelled. Please try again.";
                        }

                        showMessage(`Sign-in failed: ${userMessage}`, 'error');
                    });
            }
        }
        window.signInWithGoogle = signInWithGoogle;

        /**
         * Signs the current user out.
         */
        function signOutUser() {
            console.log("=== Sign Out CTA clicked ===");
            if (confirm("Are you sure you want to sign out?")) {
                console.log("User confirmed sign out");
                signOut(auth).catch((error) => {
                    console.error("Sign-Out Error:", error);
                    showMessage(`Sign-out failed: ${error.message}`, 'error');
                });
            }
        }
        window.signOutUser = signOutUser;

        async function initializeFirebase() {
            // --- New check for valid Firebase config ---
            if (!firebaseConfig || !firebaseConfig.apiKey) {
                document.getElementById('sign-in-view').innerHTML = '<p class="text-red-500">Firebase configuration is missing. App cannot start.</p>';
                document.getElementById('sign-in-view').style.display = 'flex';
                document.getElementById('loading-overlay').style.display = 'none';
                return;
            }
            // --- End of new check ---

            try {
                const app = initializeApp(firebaseConfig);
                db = getFirestore(app);
                auth = getAuth(app);

                // Set explicit persistence to ensure session persists across browser restarts
                try {
                    await setPersistence(auth, browserLocalPersistence);
                    console.log("Session persistence configured: browserLocalPersistence");
                } catch (persistenceError) {
                    console.warn("Failed to set persistence, using default:", persistenceError);
                    // Continue anyway - Firebase will use default persistence
                }

                onAuthStateChanged(auth, async (user) => {
                    try {
                        const signInView = document.getElementById('sign-in-view');
                        const mainAppContainer = document.getElementById('main-app-container');
                        const signOutBtn = document.getElementById('sign-out-btn');
                        const loadingOverlay = document.getElementById('loading-overlay');

                        if (user) {
                            // User is signed in
                            userId = user.uid;
                            console.log("Firebase Auth successful. User ID:", userId);

                            signInView.style.display = 'none';
                            mainAppContainer.style.display = 'block';
                            signOutBtn.style.display = 'block';
                            loadingOverlay.style.display = 'flex';
                            document.getElementById('loading-message').textContent = `Welcome, ${user.displayName || 'user'}! Loading data...`;

                            setupRealtimeListeners();
                        } else {
                            // User is signed out
                            userId = null;
                            console.log("No user signed in.");

                            // Clean up listeners before clearing data
                            cleanupRealtimeListeners();

                            // Reset app state
                            exercises = [];
                            sessionLogs = [];
                            renderExercises(); // Clear lists
                            renderHistoryChart();

                            loadingOverlay.style.display = 'none';
                            mainAppContainer.style.display = 'none';
                            signOutBtn.style.display = 'none';
                            signInView.style.display = 'flex';
                        }
                    } catch (error) {
                        console.error("Error in auth state change handler:", error);
                        showMessage("An error occurred. Please refresh the page.", 'error');
                    }
                });

                // Non-blocking: catch errors from the redirect sign-in flow on mobile.
                // onAuthStateChanged handles the successful redirect auth state automatically.
                if (isMobileBrowser()) {
                    getRedirectResult(auth).catch((error) => {
                        if (error.code !== 'auth/null-user') {
                            console.error("Redirect sign-in error:", error.code, error.message);
                            showMessage(`Sign-in failed: ${error.message}`, 'error');
                        }
                    });
                }

            } catch (error) {
                console.error("Firebase Initialization Error:", error);
                document.getElementById('loading-message').textContent = `Init failed: ${error.message}.`;
            }
        }

        /**
         * Renders the workout selector dropdown on the My Program tab.
         */
        function renderWorkoutSelector() {
            const selector = document.getElementById('workout-selector');
            if (!selector) return;

            selector.innerHTML = '';

            if (workouts.length === 0) {
                selector.innerHTML = '<p class="text-gray-500 dark:text-gray-400 text-sm">No workouts created. Create one to get started.</p>';
                return;
            }

            const select = document.createElement('select');
            select.id = 'workout-dropdown';
            select.className = 'block w-full rounded-lg bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 dark:text-gray-200 shadow-sm p-2 text-sm focus:ring-cyan-500 focus:border-cyan-500';
            select.addEventListener('change', (e) => {
                currentWorkoutId = e.target.value;
                renderExercises();
                renderWorkoutForm();
            });

            workouts.forEach(workout => {
                const option = document.createElement('option');
                option.value = workout.id;
                option.textContent = workout.name;
                if (workout.id === currentWorkoutId) {
                    option.selected = true;
                }
                select.appendChild(option);
            });

            selector.appendChild(select);

            // Re-render exercises and workout form after setting the dropdown
            // (programmatically setting select.value doesn't trigger 'change' event)
            renderExercises();
            renderWorkoutForm();
        }
        window.renderWorkoutSelector = renderWorkoutSelector;

        /**
         * Creates a default workout if none exist.
         */
        async function createDefaultWorkout() {
            if (!userId || !db) return;

            try {
                const workoutData = {
                    name: 'Default',
                    description: 'Your default workout',
                    order: 0,
                    sections: [
                        { id: 'default-section', name: 'Exercises', order: 0 }
                    ]
                };

                const workoutsPath = getPrivateCollectionPath('workouts');
                const docRef = await addDoc(collection(db, workoutsPath), workoutData);
                console.log("Default workout created with ID:", docRef.id);
                return docRef.id;
            } catch (error) {
                console.error("Error creating default workout:", error);
            }
        }

        /**
         * Migrates existing exercises without workoutId to the default workout.
         */
        async function migrateExercisesToDefaultWorkout() {
            if (!userId || !db || exercises.length === 0) return;

            try {
                // Find exercises without workoutId
                const exercisesNeedingMigration = exercises.filter(ex => !ex.workoutId);

                if (exercisesNeedingMigration.length === 0) {
                    console.log("No exercises need migration");
                    return;
                }

                // Get the default workout
                const defaultWorkout = workouts.find(w => w.name === 'Default');
                if (!defaultWorkout) {
                    console.error("Default workout not found for migration");
                    return;
                }

                const defaultSectionId = defaultWorkout.sections && defaultWorkout.sections.length > 0
                    ? defaultWorkout.sections[0].id
                    : 'default-section';

                // Batch update exercises
                const batch = writeBatch(db);
                const exercisesPath = getPrivateCollectionPath('exercises');

                exercisesNeedingMigration.forEach(exercise => {
                    const ref = doc(db, exercisesPath, exercise.Exercise_ID);
                    batch.update(ref, {
                        workoutId: defaultWorkout.id,
                        sectionId: defaultSectionId
                    });
                });

                await batch.commit();
                console.log(`Migrated ${exercisesNeedingMigration.length} exercises to default workout`);
            } catch (error) {
                console.error("Error migrating exercises:", error);
            }
        }

        /**
         * Cleans up existing real-time listeners to prevent duplicates and memory leaks.
         */
        function cleanupRealtimeListeners() {
            if (unsubscribeExercises) {
                unsubscribeExercises();
                unsubscribeExercises = null;
                console.log("Cleaned up exercises listener");
            }
            if (unsubscribeSessionLogs) {
                unsubscribeSessionLogs();
                unsubscribeSessionLogs = null;
                console.log("Cleaned up session logs listener");
            }
            if (unsubscribeWorkouts) {
                unsubscribeWorkouts();
                unsubscribeWorkouts = null;
                console.log("Cleaned up workouts listener");
            }
            isListenersSetup = false;
        }

        /**
         * Sets up real-time listeners for the two main data collections.
         * Prevents duplicate listener setup by checking isListenersSetup flag.
         */
        function setupRealtimeListeners() {
            if (!userId || !db) return;

            // Clean up any existing listeners before setting up new ones
            if (isListenersSetup) {
                console.log("Listeners already set up, cleaning up old ones first");
                cleanupRealtimeListeners();
            }

            // 1. Listen for Exercise changes (Master Library)
            const exercisesPath = getPrivateCollectionPath('exercises');
            if (exercisesPath) {
                const q = query(collection(db, exercisesPath), orderBy("order", "asc"));
                unsubscribeExercises = onSnapshot(q, (snapshot) => {
                    exercises = snapshot.docs.map(doc => ({ Exercise_ID: doc.id, ...doc.data() }));
                    renderExercises();
                    renderWorkoutForm(); // Render the new workout form

                    // If loading overlay is visible, this is likely the initial load
                    const overlay = document.getElementById('loading-overlay');
                    if (overlay && overlay.style.display !== 'none') {
                        overlay.style.display = 'none';
                        document.getElementById('loading-message').textContent = ''; // Clear loading text
                        window.switchTab('dashboard-tab');
                    }
                }, (error) => {
                    console.error("Error fetching exercises:", error);
                    showMessage("Failed to load exercise list.", 'error');
                });
            }

            // 2. Listen for Session Log changes (Tracking History)
            const logsPath = getPrivateCollectionPath('logs');
            if (logsPath) {
                unsubscribeSessionLogs = onSnapshot(collection(db, logsPath), (snapshot) => {
                    // Convert Firestore Timestamps to JS Date objects on load for sorting
                    sessionLogs = snapshot.docs.map(doc => ({ Log_ID: doc.id, ...doc.data() }));
                    // If we are in the detail view, refresh the log history
                    if (currentExerciseId) {
                         renderRelatedLogs(currentExerciseId);
                    }
                    // Re-render the overall history chart
                    renderHistoryChart();
                    // Re-render weekly activity
                    renderWeeklyActivity();
                }, (error) => {
                    console.error("Error fetching session logs:", error);
                    showMessage("Failed to load session history.", 'error');
                });
            }

            // 3. Listen for Workouts
            const workoutsPath = getPrivateCollectionPath('workouts');
            if (workoutsPath) {
                unsubscribeWorkouts = onSnapshot(collection(db, workoutsPath), async (snapshot) => {
                    workouts = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
                    // Sort by order field
                    workouts.sort((a, b) => (a.order || 0) - (b.order || 0));

                    // If no workouts exist yet, create a default one
                    if (workouts.length === 0) {
                        await createDefaultWorkout();
                        // The listener will fire again with the new workout, so we return here
                        return;
                    }

                    // If no current workout is selected, select the first one
                    if (!currentWorkoutId && workouts.length > 0) {
                        currentWorkoutId = workouts[0].id;
                    }

                    // Migrate existing exercises to default workout if needed
                    migrateExercisesToDefaultWorkout();

                    // Update UI to reflect workouts
                    renderWorkoutSelector();
                }, (error) => {
                    console.error("Error fetching workouts:", error);
                    showMessage("Failed to load workouts.", 'error');
                });
            }

            isListenersSetup = true;
            console.log("Real-time listeners set up successfully");

            // Default to Dashboard
            window.switchTab('dashboard-tab');
        }

        function toggleSetDetails(button) {
            console.log("=== Toggle Set Details CTA ===");
            try {
                event.preventDefault();
            } catch (e) {
                console.warn("Could not prevent default event");
            }
            const setGroup = button.closest('.set-group');
            if (!setGroup) return;

            const detailsSection = setGroup.querySelector('.set-details');
            if (!detailsSection) return;

            const isHidden = detailsSection.classList.contains('hidden');

            if (isHidden) {
                detailsSection.classList.remove('hidden');
                button.textContent = '−';
                button.classList.add('text-cyan-600');
                button.classList.remove('text-gray-400');

                // Set up slider listeners when section is shown
                setupSliderListeners(setGroup);
            } else {
                detailsSection.classList.add('hidden');
                button.textContent = '+';
                button.classList.remove('text-cyan-600');
                button.classList.add('text-gray-400');
            }
        }
        window.toggleSetDetails = toggleSetDetails;

        function setupSliderListeners(setGroup) {
            const rpeSlider = setGroup.querySelector('.rpe-slider');
            const painSlider = setGroup.querySelector('.pain-slider');

            if (rpeSlider) {
                const rpeDisplay = setGroup.querySelector('[data-rpe-display]');
                rpeSlider.addEventListener('input', (e) => {
                    if (rpeDisplay) {
                        rpeDisplay.textContent = e.target.value;
                    }
                });
                // Set initial display value if slider has value
                if (rpeSlider.value && rpeDisplay) {
                    rpeDisplay.textContent = rpeSlider.value;
                }
            }

            if (painSlider) {
                const painDisplay = setGroup.querySelector('[data-pain-display]');
                painSlider.addEventListener('input', (e) => {
                    if (painDisplay) {
                        painDisplay.textContent = e.target.value;
                    }
                });
                // Set initial display value if slider has value
                if (painSlider.value && painDisplay) {
                    painDisplay.textContent = painSlider.value;
                }
            }
        }

        function addSet(exerciseId) {
            console.log(`=== Add Set CTA for exercise: ${exerciseId} ===`);
            try {
                event.preventDefault();
            } catch (e) {
                console.warn("Could not prevent default event");
            }
            const container = document.getElementById(`sets-container_${exerciseId}`);
            if (!container) {
                console.error(`Sets container not found: sets-container_${exerciseId}`);
                return;
            }
            console.log("Adding new set to exercise");

            // Count actual set groups (not headers)
            const setCount = container.querySelectorAll('.set-group').length + 1;
            const newSetHtml = `
                <div class="set-group">
                    <div class="grid grid-cols-[40px_1fr_1fr_1fr_30px_30px] gap-2 items-center set-row">
                        <span class="text-sm font-medium text-gray-500 dark:text-gray-400">Set ${setCount}</span>
                        <input type="text" name="reps_${exerciseId}" class="block w-full rounded-md bg-gray-50 dark:bg-gray-600 border-gray-300 dark:border-gray-500 dark:text-gray-200 shadow-sm p-2 text-sm focus:ring-cyan-500 focus:border-cyan-500" placeholder="">
                        <input type="text" name="weight_${exerciseId}" class="block w-full rounded-md bg-gray-50 dark:bg-gray-600 border-gray-300 dark:border-gray-500 dark:text-gray-200 shadow-sm p-2 text-sm focus:ring-cyan-500 focus:border-cyan-500" placeholder="">
                        <input type="text" name="var_${exerciseId}" class="block w-full rounded-md bg-gray-50 dark:bg-gray-600 border-gray-300 dark:border-gray-500 dark:text-gray-200 shadow-sm p-2 text-sm focus:ring-cyan-500 focus:border-cyan-500" placeholder="">
                        <button type="button" onclick="removeSet(this)" class="text-red-500 hover:text-red-700 text-xl leading-none justify-self-center">×</button>
                        <button type="button" onclick="toggleSetDetails(this)" class="text-gray-400 hover:text-cyan-600 text-lg leading-none justify-self-center font-bold" title="Show RPE & Pain">+</button>
                    </div>
                    <!-- RPE & Pain Detail Section (Hidden by default) -->
                    <div class="set-details hidden bg-gray-100 dark:bg-gray-600 p-3 rounded-lg mt-2 ml-12 mr-0 space-y-3">
                        <div>
                            <div class="flex justify-between items-center mb-1">
                                <label class="text-xs font-medium text-gray-700 dark:text-gray-300">RPE (6-20)</label>
                                <span class="text-sm font-bold text-cyan-600 dark:text-cyan-400" data-rpe-display="${setCount}">--</span>
                            </div>
                            <input type="range" name="rpe_${exerciseId}" min="6" max="20" class="w-full rpe-slider" data-set-id="${setCount}">
                        </div>
                        <div>
                            <div class="flex justify-between items-center mb-1">
                                <label class="text-xs font-medium text-gray-700 dark:text-gray-300">Pain (1-5)</label>
                                <span class="text-sm font-bold text-red-600 dark:text-red-400" data-pain-display="${setCount}">--</span>
                            </div>
                            <input type="range" name="pain_${exerciseId}" min="1" max="5" class="w-full pain-slider" data-set-id="${setCount}">
                        </div>
                    </div>
                </div>
            `;
            container.insertAdjacentHTML('beforeend', newSetHtml);

            // Setup slider listeners for the newly added set
            const newSetGroup = container.querySelector(`.set-group:last-child`);
            if (newSetGroup) setupSliderListeners(newSetGroup);
        }
        window.addSet = addSet;

        function removeSet(button) {
            event.preventDefault();
            button.closest('.set-row').remove();
        }
        window.removeSet = removeSet;

        function renderWorkoutForm() {
            const container = document.getElementById('log-workout-tab');
            if (!container) return;

            // Filter exercises for current workout
            const filteredExercises = exercises.filter(ex => ex.workoutId === currentWorkoutId);

            if (filteredExercises.length === 0) {
                container.innerHTML = '<p class="text-gray-500 text-center mt-8">No exercises in this workout. Add some to your program first!</p>';
                return;
            }

            // Get the current workout to access sections
            const currentWorkout = workouts.find(w => w.id === currentWorkoutId);
            if (!currentWorkout || !currentWorkout.sections) {
                container.innerHTML = '<p class="text-gray-500 text-center mt-8">Workout not found.</p>';
                return;
            }

            let formHtml = `
                <h2 class="text-2xl font-bold text-gray-800 dark:text-gray-100 mb-1">Log Daily Workout</h2>
                <p class="text-sm text-gray-500 dark:text-gray-400 mb-6">For each exercise, add and fill in the sets you completed. Only sets with 'Reps' filled in will be saved.</p>
                <form id="log-workout-form">
            `;

            // Group exercises by section
            const groupedBySection = {};
            currentWorkout.sections.forEach(section => {
                groupedBySection[section.id] = [];
            });

            filteredExercises.forEach(exercise => {
                if (groupedBySection[exercise.sectionId]) {
                    groupedBySection[exercise.sectionId].push(exercise);
                }
            });

            // Render sections and exercises
            currentWorkout.sections.forEach(section => {
                const sectionExercises = groupedBySection[section.id] || [];

                if (sectionExercises.length === 0) return; // Skip empty sections

                formHtml += `<h3 class="text-sm font-bold text-gray-700 dark:text-gray-300 uppercase tracking-widest mt-6 mb-3">${section.name}</h3>`;

                sectionExercises.forEach(exercise => {
                const exId = exercise.Exercise_ID;
                formHtml += `
                    <div class="bg-white dark:bg-gray-700 p-4 rounded-xl shadow-md mb-4 border-l-4 border-gray-200 dark:border-gray-600">
                        <div class="flex justify-between items-center mb-3">
                            <div class="flex items-center gap-2">
                                <p class="font-bold text-gray-800 dark:text-gray-100 text-lg">${exercise.Name}</p>
                                <span class="bg-gray-100 dark:bg-gray-600 text-gray-500 dark:text-gray-400 text-[10px] px-2 py-0.5 rounded uppercase tracking-wider">${exercise.Focus_Area || ''}</span>
                            </div>
                            <button type="button" onclick="showExerciseHistory('${exId}')" class="text-cyan-600 dark:text-cyan-400 hover:bg-cyan-100 dark:hover:bg-gray-600 p-2 rounded-full transition-colors" title="View History">
                                <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
                            </button>
                        </div>
                        
                        <div id="sets-container_${exId}" class="space-y-3 mt-3">
                            <!-- Headers -->
                            <div class="grid grid-cols-[40px_1fr_1fr_1fr_30px_30px] gap-2 items-center text-xs text-gray-500 dark:text-gray-400 font-medium mb-1">
                                <span></span>
                                <span>Reps</span>
                                <span>Weight</span>
                                <span>Var</span>
                                <span></span>
                                <span></span>
                            </div>

                            <!-- Set 1 (Default) -->
                            <div class="set-group">
                                <div class="grid grid-cols-[40px_1fr_1fr_1fr_30px_30px] gap-2 items-center set-row">
                                    <span class="text-sm font-medium text-gray-500 dark:text-gray-400">Set 1</span>
                                    <input type="text" name="reps_${exId}" class="block w-full rounded-md bg-gray-50 dark:bg-gray-600 border-gray-300 dark:border-gray-500 dark:text-gray-200 shadow-sm p-2 text-sm focus:ring-cyan-500 focus:border-cyan-500" placeholder="">
                                    <input type="text" name="weight_${exId}" class="block w-full rounded-md bg-gray-50 dark:bg-gray-600 border-gray-300 dark:border-gray-500 dark:text-gray-200 shadow-sm p-2 text-sm focus:ring-cyan-500 focus:border-cyan-500" placeholder="">
                                    <input type="text" name="var_${exId}" class="block w-full rounded-md bg-gray-50 dark:bg-gray-600 border-gray-300 dark:border-gray-500 dark:text-gray-200 shadow-sm p-2 text-sm focus:ring-cyan-500 focus:border-cyan-500" placeholder="">
                                    <button type="button" onclick="removeSet(this)" class="text-red-500 hover:text-red-700 text-xl leading-none justify-self-center">×</button>
                                    <button type="button" onclick="toggleSetDetails(this)" class="text-gray-400 hover:text-cyan-600 text-lg leading-none justify-self-center font-bold" title="Show RPE & Pain">+</button>
                                </div>
                                <!-- RPE & Pain Detail Section (Hidden by default) -->
                                <div class="set-details hidden bg-gray-100 dark:bg-gray-600 p-3 rounded-lg mt-2 ml-12 mr-0 space-y-3">
                                    <div>
                                        <div class="flex justify-between items-center mb-1">
                                            <label class="text-xs font-medium text-gray-700 dark:text-gray-300">RPE (6-20)</label>
                                            <span class="text-sm font-bold text-cyan-600 dark:text-cyan-400" data-rpe-display="1">--</span>
                                        </div>
                                        <input type="range" name="rpe_${exId}" min="6" max="20" class="w-full rpe-slider" data-set-id="1">
                                    </div>
                                    <div>
                                        <div class="flex justify-between items-center mb-1">
                                            <label class="text-xs font-medium text-gray-700 dark:text-gray-300">Pain (1-5)</label>
                                            <span class="text-sm font-bold text-red-600 dark:text-red-400" data-pain-display="1">--</span>
                                        </div>
                                        <input type="range" name="pain_${exId}" min="1" max="5" class="w-full pain-slider" data-set-id="1">
                                    </div>
                                </div>
                            </div>
                        </div>
                        <button type="button" onclick="addSet('${exId}')" class="text-sm text-cyan-600 dark:text-cyan-400 hover:underline mt-3 font-medium">+ Add Set</button>
                    </div>
                `;
                });
            });

            formHtml += `
                    <button type="submit" class="w-full mt-6 bg-green-500 hover:bg-green-600 text-white text-lg font-bold py-3 rounded-xl shadow-lg">
                        Save Workout
                    </button>
                </form>
            `;
            container.innerHTML = formHtml;

            // Attach form listener with error handling for Safari compatibility
            try {
                const workoutForm = document.getElementById('log-workout-form');
                if (workoutForm) {
                    // Remove any existing listeners to prevent duplicates
                    workoutForm.replaceWith(workoutForm.cloneNode(true));
                    const freshForm = document.getElementById('log-workout-form');
                    if (freshForm) {
                        freshForm.addEventListener('submit', handleWorkoutSubmission);
                        console.log("Log workout form listener attached successfully");

                        // Setup slider listeners for all initially rendered sets
                        const setGroups = freshForm.querySelectorAll('.set-group');
                        setGroups.forEach(setGroup => setupSliderListeners(setGroup));
                    }
                } else {
                    console.warn("Log workout form not found when trying to attach listener");
                }
            } catch (error) {
                console.error("Error attaching log workout form listener:", error);
            }
        }

        function showSaveConfirmation() {
            return new Promise((resolve) => {
                const overlay = document.createElement('div');
                overlay.className = 'fixed inset-0 z-50 flex items-end justify-center p-4 bg-black bg-opacity-50';
                overlay.innerHTML = `
                    <div class="bg-white dark:bg-gray-800 rounded-2xl shadow-xl w-full max-w-sm p-6 mb-4">
                        <h3 class="text-lg font-bold text-gray-800 dark:text-gray-100 mb-1">Save workout?</h3>
                        <p class="text-sm text-gray-500 dark:text-gray-400 mb-5">Are you done, or do you want to keep going?</p>
                        <div class="flex flex-col gap-3">
                            <button id="confirm-save-btn" class="w-full bg-green-500 hover:bg-green-600 active:bg-green-700 text-white text-base font-bold py-3 rounded-xl">
                                Save Workout
                            </button>
                            <button id="confirm-resume-btn" class="w-full bg-gray-100 hover:bg-gray-200 active:bg-gray-300 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-200 text-base font-semibold py-3 rounded-xl">
                                Resume Workout
                            </button>
                        </div>
                    </div>
                `;
                document.body.appendChild(overlay);

                overlay.querySelector('#confirm-save-btn').addEventListener('click', () => {
                    document.body.removeChild(overlay);
                    resolve(true);
                });
                overlay.querySelector('#confirm-resume-btn').addEventListener('click', () => {
                    document.body.removeChild(overlay);
                    resolve(false);
                });
            });
        }

        async function handleWorkoutSubmission(event) {
            console.log("Log workout submission started");

            try {
                event.preventDefault();
            } catch (error) {
                console.error("Error preventing default form submission:", error);
            }

            if (!userId) {
                showMessage("Authentication error. Please reload.", 'error');
                console.error("No user ID found when submitting workout");
                return;
            }

            if (!db) {
                showMessage("Database not initialized. Please reload.", 'error');
                console.error("Database not initialized");
                return;
            }

            const form = event.target;
            if (!form) {
                console.error("Form element not found in event target");
                showMessage("Form error. Please try again.", 'error');
                return;
            }

            const submitBtn = form.querySelector('button[type="submit"]');

            // Prevent double submission
            if (submitBtn) {
                submitBtn.disabled = true;
            } else {
                console.warn("Submit button not found");
            }

            const batch = writeBatch(db);
            const logsCollectionRef = collection(db, getPrivateCollectionPath('logs'));
            let logsAttempted = 0;
            const workoutDate = new Date();

            // Only process exercises from the current workout
            const filteredExercises = exercises.filter(ex => ex.workoutId === currentWorkoutId);
            filteredExercises.forEach(exercise => {
                const exId = exercise.Exercise_ID;
                const setsContainer = document.getElementById(`sets-container_${exId}`);
                if (!setsContainer) return;

                const setGroups = setsContainer.querySelectorAll('.set-group');
                setGroups.forEach((setGroup, index) => {
                    const row = setGroup.querySelector('.set-row');
                    if (!row) return;

                    const repsInput = row.querySelector(`input[name="reps_${exId}"]`);
                    const reps = repsInput ? repsInput.value.trim() : '';

                    if (reps) {
                        logsAttempted++;
                        const newLogRef = doc(logsCollectionRef);

                        // Extract optional RPE and Pain values if provided
                        const rpeInput = setGroup.querySelector(`input[name="rpe_${exId}"]`);
                        const painInput = setGroup.querySelector(`input[name="pain_${exId}"]`);

                        // Check if sliders have been interacted with (value > 0, since min is 6 for RPE and 1 for Pain)
                        const rpeValue = rpeInput ? parseInt(rpeInput.value, 10) : null;
                        const painValue = painInput ? parseInt(painInput.value, 10) : null;

                        const logData = {
                            Exercise_ID: exId,
                            Date: workoutDate,
                            SetNumber: index + 1,
                            Actual_Reps: reps,
                            Weight_Used: row.querySelector(`input[name="weight_${exId}"]`).value.trim(),
                            Variation: row.querySelector(`input[name="var_${exId}"]`).value.trim(),
                            Subjective_Feeling: 3,
                            Comments: ''
                        };

                        // Only add RPE and Pain if they have values
                        if (rpeValue !== null) logData.RPE = rpeValue;
                        if (painValue !== null) logData.Pain = painValue;

                        batch.set(newLogRef, logData);
                    }
                });
            });

            if (logsAttempted === 0) {
                showMessage("No sets were logged. Please enter the reps for at least one set.", 'error');
                if (submitBtn) submitBtn.disabled = false;
                return;
            }

            const confirmed = await showSaveConfirmation();
            if (!confirmed) {
                if (submitBtn) submitBtn.disabled = false;
                return;
            }

            try {
                await batch.commit();
                
                // Success feedback and clear
                alert("Workout Saved Successfully! Great job."); // Simple feedback as requested
                form.reset();
                renderWorkoutForm(); // Re-render to reset the set rows to default (1 set)
                
                // Enable button again (though form is reset)
                if (submitBtn) submitBtn.disabled = false;
                
                // Stay on screen or switch? Spec said "return to My Program screen" but "when the user returns... sees a blank form".
                // "The expected behavior is to record the workout and then show a success screen."
                // Simple alert + reset satisfies "blank form so they can start a new workout".
                
            } catch (error) {
                console.error("Error writing batch: ", error);

                // Provide more specific error messages based on the error type
                let errorMessage = "Failed to save workout.";
                if (error.code === 'permission-denied') {
                    errorMessage = "Permission denied. Please sign in again.";
                } else if (error.code === 'not-authenticated') {
                    errorMessage = "You are not signed in. Please reload and sign in.";
                } else if (error.message) {
                    errorMessage = `Failed to save workout: ${error.message}`;
                }

                console.error("Full error details:", error.code, error.message, error);
                showMessage(errorMessage, 'error');
                if (submitBtn) submitBtn.disabled = false;
            }
        }

        /**
         * Renders the specific history for a single exercise.
         * @param {string} exerciseId 
         */
        function showExerciseHistory(exerciseId) {
            const exercise = exercises.find(e => e.Exercise_ID === exerciseId);
            if (!exercise) return;

            document.getElementById('history-exercise-title').textContent = `History: ${exercise.Name}`;
            const container = document.getElementById('exercise-history-list');
            container.innerHTML = '';

            const historyLogs = sessionLogs
                .filter(log => log.Exercise_ID === exerciseId)
                .sort((a, b) => b.Date.toDate() - a.Date.toDate());

            if (historyLogs.length === 0) {
                container.innerHTML = '<p class="text-gray-500 dark:text-gray-400 text-center">No history recorded yet.</p>';
                window.switchTab('exercise-history-tab');
                return;
            }

            // Group by Session (Date)
            const sessions = historyLogs.reduce((acc, log) => {
                const sessionTime = log.Date.toDate().getTime();
                if (!acc[sessionTime]) {
                    acc[sessionTime] = { date: log.Date.toDate(), logs: [] };
                }
                acc[sessionTime].logs.push(log);
                return acc;
            }, {});

            const sortedSessions = Object.values(sessions).sort((a, b) => b.date - a.date);

            container.innerHTML = sortedSessions.map(session => {
                const dateStr = session.date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
                const timeStr = session.date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                const sets = session.logs.sort((a, b) => a.SetNumber - b.SetNumber);

                return `
                    <div class="bg-white dark:bg-gray-700 p-4 rounded-xl shadow-sm border border-gray-200 dark:border-gray-600">
                        <div class="flex justify-between items-center mb-2 border-b dark:border-gray-600 pb-2">
                            <span class="font-bold text-gray-800 dark:text-gray-100">${dateStr}</span>
                            <span class="text-xs text-gray-500 dark:text-gray-400">${timeStr}</span>
                        </div>
                        <ul class="space-y-2 text-sm">
                            ${sets.map(set => `
                                <li class="flex justify-between items-center">
                                    <span class="font-medium text-gray-600 dark:text-gray-300">Set ${set.SetNumber}</span>
                                    <div class="text-right">
                                        <span class="block text-gray-800 dark:text-gray-100 font-semibold">${set.Actual_Reps} <span class="text-xs font-normal text-gray-500">reps</span> @ ${set.Weight_Used || '0'}</span>
                                        ${set.Variation ? `<span class="text-xs text-cyan-600 dark:text-cyan-400 italic">${set.Variation}</span>` : ''}
                                    </div>
                                </li>
                            `).join('')}
                        </ul>
                    </div>
                `;
            }).join('');

            window.switchTab('exercise-history-tab');
        }
        window.showExerciseHistory = showExerciseHistory;

        /**
         * Renders the simplified History Chart (just a list for simplicity in this single file PWA).
         */
        function renderHistoryChart() {
            const container = document.getElementById('history-list');
            if (!container) return;

            if (sessionLogs.length === 0) {
                 container.innerHTML = '<p class="text-gray-500 dark:text-gray-400 text-center mt-8">No history logged yet. Log your first workout!</p>';
                 return;
            }

            const exerciseMap = new Map(exercises.map(e => [e.Exercise_ID, e.Name]));

            // Group logs by workout session (a session is all logs with the same timestamp)
            const sessions = sessionLogs.reduce((acc, log) => {
                const sessionTime = log.Date.toDate().getTime();
                if (!acc[sessionTime]) {
                    acc[sessionTime] = { date: log.Date.toDate(), logs: [] };
                }
                acc[sessionTime].logs.push(log);
                return acc;
            }, {});

            // Sort sessions by date, newest first
            const sortedSessions = Object.values(sessions).sort((a, b) => b.date - a.date);

            container.innerHTML = sortedSessions.map(session => {
                const dateStr = session.date.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
                const timeStr = session.date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

                // Group logs within the session by exercise
                const exercisesInSession = session.logs.reduce((acc, log) => {
                    const exerciseName = exerciseMap.get(log.Exercise_ID) || 'Unknown Exercise';
                    if (!acc[exerciseName]) {
                        acc[exerciseName] = [];
                    }
                    acc[exerciseName].push(log);
                    return acc;
                }, {});

                let exerciseHtml = '';
                for (const exName in exercisesInSession) {
                    const sets = exercisesInSession[exName].sort((a, b) => a.SetNumber - b.SetNumber);
                    exerciseHtml += `
                        <div class="mt-3 border-b border-gray-100 dark:border-gray-600 pb-2 last:border-0">
                            <h4 class="font-bold text-gray-700 dark:text-gray-200 text-sm">${exName}</h4>
                            <ul class="text-sm text-gray-600 dark:text-gray-300 mt-1 space-y-1 pl-2">
                                ${sets.map(set => {
                                    let metricsStr = '';
                                    if (set.RPE) metricsStr += `RPE: ${set.RPE}`;
                                    if (set.Pain) metricsStr += (metricsStr ? ' • ' : '') + `Pain: ${set.Pain}`;
                                    return `
                                    <li class="flex justify-between items-start gap-2">
                                        <span>
                                            <strong>Set ${set.SetNumber}:</strong> ${set.Actual_Reps}
                                            <span class="text-gray-500 dark:text-gray-400">@ ${set.Weight_Used || '0'}</span>
                                            ${set.Variation ? `<span class="text-cyan-600 dark:text-cyan-400">(${set.Variation})</span>` : ''}
                                        </span>
                                        ${metricsStr ? `<span class="text-xs text-yellow-600 dark:text-yellow-400 whitespace-nowrap">${metricsStr}</span>` : ''}
                                    </li>
                                `}).join('')}
                            </ul>
                        </div>
                    `;
                }

                return `
                    <details class="bg-white dark:bg-gray-700 rounded-xl shadow-md border-l-4 border-cyan-500 dark:border-cyan-400 mb-4 overflow-hidden group">
                        <summary class="flex justify-between items-center p-4 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-600 transition-colors focus:outline-none">
                            <div>
                                <h3 class="font-bold text-gray-800 dark:text-gray-100 text-base">${dateStr}</h3>
                                <span class="text-xs text-gray-500 dark:text-gray-400">${timeStr}</span>
                            </div>
                            <svg class="w-5 h-5 text-gray-400 group-open:rotate-180 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"></path></svg>
                        </summary>
                        <div class="p-4 pt-0 bg-white dark:bg-gray-700">
                            ${exerciseHtml}
                        </div>
                    </details>
                `;
            }).join('');
        }

        // Register form event listeners with fallback for Safari compatibility
        try {
            const addExerciseForm = document.getElementById('add-exercise-form');
            if (addExerciseForm) {
                addExerciseForm.addEventListener('submit', handleAddExerciseSubmission);
                console.log("Add exercise form listener registered");
            } else {
                console.warn("Add exercise form not found when trying to attach listener");
            }
        } catch (error) {
            console.error("Error attaching form listener:", error);
        }

        // Prevent duplicate Firebase initialization
        if (!isFirebaseInitialized) {
            isFirebaseInitialized = true;
            initializeFirebase();
        }