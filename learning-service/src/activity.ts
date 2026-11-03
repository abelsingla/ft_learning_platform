export type ExerciseStatus = 'available' | 'in_progress' | 'completed' | 'locked';

export interface ActivityManifest {
    schemaVersion: 1;
    activityId: string;
    revision: string;
    title: string;
    description: string;
    exercises: Array<{
        id: string;
        title: string;
        summary: string;
        instructions: string[];
        difficulty: 'beginner' | 'intermediate' | 'advanced';
        estimatedMinutes: number;
        status: ExerciseStatus;
    }>;
}

export const activityManifest: ActivityManifest = {
    schemaVersion: 1,
    activityId: 'hand-sensing-foundations',
    revision: '1',
    title: 'Hand-controlled character',
    description: 'Learn how to use hand detection and gestures to control a Scratch character.',
    exercises: [
        {
            id: 'detect-a-hand',
            title: 'Detect a hand',
            summary: 'Make the character react when the camera detects either hand.',
            instructions: [
                'Add the Hand Sensing extension.',
                'Use the hand detected block inside a control condition.',
                'Make the character say a message when a hand is visible.'
            ],
            difficulty: 'beginner',
            estimatedMinutes: 10,
            status: 'available'
        },
        {
            id: 'move-with-index-finger',
            title: 'Move with your index finger',
            summary: 'Use the index fingertip position to move a character around the stage.',
            instructions: [
                'Read the x and y position of the index fingertip.',
                'Use those values to set the character position.',
                'Test the program with both slow and fast hand movements.'
            ],
            difficulty: 'beginner',
            estimatedMinutes: 15,
            status: 'available'
        },
        {
            id: 'gesture-challenge',
            title: 'Create a gesture challenge',
            summary: 'Combine several gestures to create an interactive challenge.',
            instructions: [
                'Choose at least three gestures from the Hand Sensing extension.',
                'Give a different response to each gesture.',
                'Add a score or a timer and test the complete challenge.'
            ],
            difficulty: 'intermediate',
            estimatedMinutes: 25,
            status: 'available'
        }
    ]
};

export const exerciseIds = new Set(activityManifest.exercises.map(exercise => exercise.id));
